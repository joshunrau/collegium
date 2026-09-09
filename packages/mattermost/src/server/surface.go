package main

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"

	"github.com/mattermost/mattermost/server/public/model"
)

// Trigger is the one slash command this plugin holds; every framework command is a subcommand of it.
const Trigger = "collegium"

const surfaceKeyPrefix = "surface:"

// declareSurfacePattern is the one route the app calls, beneath /plugins/{id}
const declareSurfacePattern = "PUT /api/v1/teams/{teamId}/commands"

var subcommandPattern = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)

// Command is one subcommand as the app declares it: the wire shape of PUT /api/v1/teams/{teamId}/commands.
type Command struct {
	Trigger string `json:"trigger"`
	Hint    string `json:"hint"`
	Purpose string `json:"purpose"`
}

// Surface is what one deployment declares for its team: where to forward executions, and the
// subcommands to autocomplete. It is persisted per team so activation can re-register it.
type Surface struct {
	CallbackURL string    `json:"callbackUrl"`
	Commands    []Command `json:"commands"`
}

func (s Surface) Validate() error {
	parsed, err := url.Parse(s.CallbackURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return fmt.Errorf("callbackUrl must be an absolute http(s) URL, got %q", s.CallbackURL)
	}
	if len(s.Commands) == 0 {
		return fmt.Errorf("commands must name at least one subcommand")
	}
	seen := map[string]bool{}
	for _, command := range s.Commands {
		if !subcommandPattern.MatchString(command.Trigger) {
			return fmt.Errorf("subcommand %q must match %s", command.Trigger, subcommandPattern)
		}
		if seen[command.Trigger] {
			return fmt.Errorf("subcommand %q is declared twice", command.Trigger)
		}
		seen[command.Trigger] = true
	}
	return nil
}

func surfaceKey(teamID string) string {
	return surfaceKeyPrefix + teamID
}

func decodeSurface(raw []byte) (Surface, error) {
	var surface Surface
	if err := json.Unmarshal(raw, &surface); err != nil {
		return Surface{}, err
	}
	return surface, surface.Validate()
}

// toCommand renders the surface as the team-scoped command Mattermost autocompletes: the trigger,
// then one subcommand per declaration, each carrying its argument hint.
func toCommand(teamID string, surface Surface) *model.Command {
	data := model.NewAutocompleteData(Trigger, "[subcommand]", "Operate the Collegium agents in this channel")
	for _, command := range surface.Commands {
		sub := model.NewAutocompleteData(command.Trigger, command.Hint, command.Purpose)
		if command.Hint != "" {
			sub.AddTextArgument(command.Purpose, command.Hint, "")
		}
		data.AddCommand(sub)
	}
	return &model.Command{
		Trigger:          Trigger,
		TeamId:           teamID,
		AutoComplete:     true,
		AutoCompleteDesc: "Operate the Collegium agents in this channel",
		AutoCompleteHint: "[subcommand]",
		DisplayName:      "Collegium",
		Description:      "Registered by the Collegium app for this team",
		AutocompleteData: data,
	}
}
