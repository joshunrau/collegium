package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

const teamID = "team-1"

func declaration(callbackURL string) string {
	return `{"callbackUrl":"` + callbackURL + `","commands":[{"trigger":"stop","hint":"","purpose":"Abort turns"},{"trigger":"forget","hint":"{post-id}","purpose":"Forget a post"}]}`
}

func newTestPlugin(t *testing.T) (*Plugin, *plugintest.API) {
	t.Helper()
	api := &plugintest.API{}
	t.Cleanup(func() { api.AssertExpectations(t) })
	p := NewPlugin()
	p.SetAPI(api)
	return p, api
}

func declare(p *Plugin, userID string, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(http.MethodPut, "/api/v1/teams/"+teamID+"/commands", strings.NewReader(body))
	if userID != "" {
		request.Header.Set("Mattermost-User-Id", userID)
	}
	recorder := httptest.NewRecorder()
	p.ServeHTTP(nil, recorder, request)
	return recorder
}

// grantDeclaration lets user-1 declare for the team and accepts whatever registration follows
func grantDeclaration(api *plugintest.API) {
	api.On("HasPermissionToTeam", "user-1", teamID, model.PermissionManageOwnSlashCommands).Return(true)
	api.On("KVSet", surfaceKey(teamID), mock.Anything).Return(nil)
	api.On("RegisterCommand", mock.Anything).Return(nil)
}

// answeringApp stands in for the app, recording what it was forwarded and answering with body
func answeringApp(t *testing.T, body string) (*httptest.Server, *forwardedCommand) {
	t.Helper()
	received := &forwardedCommand{}
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, received)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(app.Close)
	return app, received
}

func TestDeclareSurfaceRequiresAuthentication(t *testing.T) {
	p, _ := newTestPlugin(t)
	require.Equal(t, http.StatusUnauthorized, declare(p, "", declaration("http://app:3000/commands")).Code)
}

func TestDeclareSurfaceRequiresTeamAuthority(t *testing.T) {
	p, api := newTestPlugin(t)
	api.On("HasPermissionToTeam", "user-1", teamID, model.PermissionManageOwnSlashCommands).Return(false)
	api.On("LogWarn", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return()
	require.Equal(t, http.StatusForbidden, declare(p, "user-1", declaration("http://app:3000/commands")).Code)
}

func TestDeclareSurfaceRegistersSubcommandsForTheTeam(t *testing.T) {
	p, api := newTestPlugin(t)
	api.On("HasPermissionToTeam", "user-1", teamID, model.PermissionManageOwnSlashCommands).Return(true)
	api.On("KVSet", surfaceKey(teamID), mock.Anything).Return(nil)
	api.On("RegisterCommand", mock.MatchedBy(func(command *model.Command) bool {
		subcommands := []string{}
		for _, sub := range command.AutocompleteData.SubCommands {
			subcommands = append(subcommands, sub.Trigger)
		}
		return command.Trigger == Trigger && command.TeamId == teamID && strings.Join(subcommands, ",") == "stop,forget"
	})).Return(nil)

	require.Equal(t, http.StatusNoContent, declare(p, "user-1", declaration("http://app:3000/commands")).Code)
}

func TestDeclareSurfaceRefusesAnInvalidDeclaration(t *testing.T) {
	p, api := newTestPlugin(t)
	api.On("HasPermissionToTeam", "user-1", teamID, model.PermissionManageOwnSlashCommands).Return(true)
	require.Equal(t, http.StatusBadRequest, declare(p, "user-1", `{"callbackUrl":"ftp://x","commands":[]}`).Code)
}

func TestExecuteCommandForwardsToTheDeclaringApp(t *testing.T) {
	app, received := answeringApp(t, `{"response_type":"ephemeral","text":"Usage: /collegium forget {post-id}"}`)
	p, api := newTestPlugin(t)
	grantDeclaration(api)
	api.On("GetUser", "user-1").Return(&model.User{Id: "user-1", Username: "casey"}, nil)
	require.Equal(t, http.StatusNoContent, declare(p, "user-1", declaration(app.URL)).Code)

	response, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
		ChannelId: "channel-1", Command: "/collegium forget  post-9 ", TeamId: teamID, UserId: "user-1",
	})
	require.Nil(t, appErr)
	require.Equal(t, forwardedCommand{ChannelID: "channel-1", TeamID: teamID, Text: "forget  post-9", UserID: "user-1", UserName: "casey"}, *received)
	require.Equal(t, &model.CommandResponse{ResponseType: "ephemeral", Text: "Usage: /collegium forget {post-id}"}, response)
}

func TestExecuteCommandRefusesAnAnswerMattermostCannotRender(t *testing.T) {
	app, _ := answeringApp(t, `{"response_type":"modal","text":"?"}`)
	p, api := newTestPlugin(t)
	grantDeclaration(api)
	api.On("GetUser", "user-1").Return(&model.User{Id: "user-1", Username: "casey"}, nil)
	require.Equal(t, http.StatusNoContent, declare(p, "user-1", declaration(app.URL)).Code)

	response, appErr := p.ExecuteCommand(nil, &model.CommandArgs{Command: "/collegium stop", TeamId: teamID, UserId: "user-1"})
	require.Nil(t, appErr)
	require.Equal(t, model.CommandResponseTypeEphemeral, response.ResponseType)
	require.Contains(t, response.Text, `"modal"`)
}

func TestExecuteCommandTellsAnUndeclaredTeamToStartTheApp(t *testing.T) {
	p, _ := newTestPlugin(t)
	response, appErr := p.ExecuteCommand(nil, &model.CommandArgs{Command: "/collegium stop", TeamId: "team-2", UserId: "user-1"})
	require.Nil(t, appErr)
	require.Contains(t, response.Text, "has not registered")
}

func TestOnActivateReregistersPersistedSurfaces(t *testing.T) {
	p, api := newTestPlugin(t)
	api.On("KVList", 0, kvPageSize).Return([]string{surfaceKey(teamID), "unrelated"}, nil)
	api.On("KVGet", surfaceKey(teamID)).Return([]byte(declaration("http://app:3000/commands")), nil)
	api.On("RegisterCommand", mock.MatchedBy(func(command *model.Command) bool { return command.TeamId == teamID })).Return(nil)

	require.NoError(t, p.OnActivate())
	_, declared := p.surfaceFor(teamID)
	require.True(t, declared)
}
