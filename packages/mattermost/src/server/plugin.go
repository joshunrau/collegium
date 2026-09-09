package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// a command does real work before it answers — an interrupt notice, a drained turn — so the wait is generous
const forwardTimeout = 60 * time.Second

const kvPageSize = 100

// Plugin holds one command surface per team, forwarding every /collegium execution on a team to the
// app that declared that team's surface. Nothing about the subcommands is known here: the app is the
// source of truth and this is the substrate's view of it.
type Plugin struct {
	plugin.MattermostPlugin

	forwarder *http.Client
	mu        sync.RWMutex
	routes    *http.ServeMux
	surfaces  map[string]Surface
}

func NewPlugin() *Plugin {
	p := &Plugin{
		forwarder: &http.Client{Timeout: forwardTimeout},
		routes:    http.NewServeMux(),
		surfaces:  map[string]Surface{},
	}
	p.routes.HandleFunc(declareSurfacePattern, p.handleDeclareSurface)
	return p
}

// OnActivate re-registers every persisted surface: registrations live in server memory and a
// restart drops them, while the app that declared them may not boot again for days.
func (p *Plugin) OnActivate() error {
	for page := 0; ; page++ {
		keys, appErr := p.API.KVList(page, kvPageSize)
		if appErr != nil {
			return appErr
		}
		for _, key := range keys {
			teamID, isSurface := strings.CutPrefix(key, surfaceKeyPrefix)
			if !isSurface {
				continue
			}
			raw, appErr := p.API.KVGet(key)
			if appErr != nil {
				return appErr
			}
			surface, err := decodeSurface(raw)
			if err != nil {
				p.API.LogError("discarding an unreadable command surface", "team_id", teamID, "error", err.Error())
				continue
			}
			if err := p.register(teamID, surface); err != nil {
				return err
			}
		}
		if len(keys) < kvPageSize {
			return nil
		}
	}
}

// ServeHTTP is the app's side of the seam: PUT /api/v1/teams/{teamId}/commands declares a team's
// surface. Authority is manage_own_slash_commands on that team — what creating a slash command
// there takes, and what the app's system bot holds as a team administrator, so nothing new is
// granted for the plugin. (manage_slash_commands is deprecated and granted to no role.)
func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.routes.ServeHTTP(w, r)
}

func (p *Plugin) handleDeclareSurface(w http.ResponseWriter, r *http.Request) {
	userID := r.Header.Get("Mattermost-User-Id")
	if userID == "" {
		http.Error(w, "authentication required", http.StatusUnauthorized)
		return
	}
	teamID := r.PathValue("teamId")
	if !p.API.HasPermissionToTeam(userID, teamID, model.PermissionManageOwnSlashCommands) {
		p.API.LogWarn("refused a command surface declaration", "user_id", userID, "team_id", teamID)
		http.Error(w, "manage_own_slash_commands on this team is required", http.StatusForbidden)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	surface, err := decodeSurface(body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if appErr := p.API.KVSet(surfaceKey(teamID), body); appErr != nil {
		http.Error(w, appErr.Error(), http.StatusInternalServerError)
		return
	}
	if err := p.register(teamID, surface); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (p *Plugin) register(teamID string, surface Surface) error {
	if err := p.API.RegisterCommand(toCommand(teamID, surface)); err != nil {
		return fmt.Errorf("registering /%s for team %s: %w", Trigger, teamID, err)
	}
	p.mu.Lock()
	p.surfaces[teamID] = surface
	p.mu.Unlock()
	return nil
}

func (p *Plugin) surfaceFor(teamID string) (Surface, bool) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	surface, ok := p.surfaces[teamID]
	return surface, ok
}

// forwardedCommand is what the app parses: the text after the trigger, and who ran it where.
type forwardedCommand struct {
	ChannelID string `json:"channel_id"`
	TeamID    string `json:"team_id"`
	Text      string `json:"text"`
	UserID    string `json:"user_id"`
	UserName  string `json:"user_name"`
}

type forwardedResponse struct {
	ResponseType string `json:"response_type"`
	Text         string `json:"text"`
}

// the app's answer is relayed as a command response, whose type Mattermost renders by; anything
// else would reach the client as a response it does not draw
func (r forwardedResponse) Validate() error {
	switch r.ResponseType {
	case model.CommandResponseTypeEphemeral, model.CommandResponseTypeInChannel:
		return nil
	default:
		return fmt.Errorf("response_type must be %q or %q, got %q", model.CommandResponseTypeEphemeral, model.CommandResponseTypeInChannel, r.ResponseType)
	}
}

// ExecuteCommand forwards the execution to the app and relays its answer. Every failure is told to
// the invoker alone: a command that cannot reach the app is still a human asking, and silence would
// read as the app having heard.
func (p *Plugin) ExecuteCommand(_ *plugin.Context, args *model.CommandArgs) (*model.CommandResponse, *model.AppError) {
	surface, ok := p.surfaceFor(args.TeamId)
	if !ok {
		return ephemeral("Collegium has not registered its commands on this team. Start the app, which declares them at boot."), nil
	}
	user, appErr := p.API.GetUser(args.UserId)
	if appErr != nil {
		return nil, appErr
	}
	_, text, _ := strings.Cut(strings.TrimSpace(args.Command), " ")
	payload, err := json.Marshal(forwardedCommand{
		ChannelID: args.ChannelId,
		TeamID:    args.TeamId,
		Text:      strings.TrimSpace(text),
		UserID:    args.UserId,
		UserName:  user.Username,
	})
	if err != nil {
		return nil, model.NewAppError("ExecuteCommand", "collegium.forward.encode", nil, err.Error(), http.StatusInternalServerError)
	}
	request, err := http.NewRequest(http.MethodPost, surface.CallbackURL, bytes.NewReader(payload))
	if err != nil {
		return nil, model.NewAppError("ExecuteCommand", "collegium.forward.request", nil, err.Error(), http.StatusInternalServerError)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := p.forwarder.Do(request)
	if err != nil {
		return ephemeral(fmt.Sprintf("Collegium is unreachable at %s: %s", surface.CallbackURL, err.Error())), nil
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return ephemeral(fmt.Sprintf("Collegium's answer could not be read: %s", err.Error())), nil
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return ephemeral(fmt.Sprintf("Collegium answered HTTP %d.", response.StatusCode)), nil
	}
	var answer forwardedResponse
	if err := json.Unmarshal(body, &answer); err != nil {
		return ephemeral(fmt.Sprintf("Collegium's answer could not be read: %s", err.Error())), nil
	}
	if err := answer.Validate(); err != nil {
		return ephemeral(fmt.Sprintf("Collegium's answer could not be read: %s", err.Error())), nil
	}
	return &model.CommandResponse{ResponseType: answer.ResponseType, Text: answer.Text}, nil
}

func ephemeral(text string) *model.CommandResponse {
	return &model.CommandResponse{ResponseType: model.CommandResponseTypeEphemeral, Text: text}
}
