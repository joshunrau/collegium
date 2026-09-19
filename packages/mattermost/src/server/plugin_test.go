package main

import (
	"encoding/json"
	"fmt"
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

const callbackToken = "test-callback-token"

func declaration(callbackURL string) string {
	return `{"callbackToken":"` + callbackToken + `","callbackUrl":"` + callbackURL + `","commands":[{"trigger":"stop","hint":"","purpose":"Abort turns"},{"trigger":"forget","hint":"{post-id}","purpose":"Forget a post"}]}`
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

// forwarded is what the app received: the command, and the bearer that says the plugin sent it
type forwarded struct {
	forwardedCommand
	Authorization string
}

// answeringApp stands in for the app, recording what it was forwarded and answering with body
func answeringApp(t *testing.T, body string) (*httptest.Server, *forwarded) {
	t.Helper()
	received := &forwarded{}
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &received.forwardedCommand)
		received.Authorization = r.Header.Get("Authorization")
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

func TestDeclareSurfaceRequiresACallbackToken(t *testing.T) {
	p, api := newTestPlugin(t)
	api.On("HasPermissionToTeam", "user-1", teamID, model.PermissionManageOwnSlashCommands).Return(true)
	require.Equal(t, http.StatusBadRequest, declare(p, "user-1", `{"callbackUrl":"http://app:3000/commands","commands":[{"trigger":"stop","hint":"","purpose":"Abort turns"}]}`).Code)
}

func TestExecuteCommandForwardsToTheDeclaringApp(t *testing.T) {
	app, received := answeringApp(t, `{"response_type":"ephemeral","text":"Usage: /collegium forget {post-id}"}`)
	p, api := newTestPlugin(t)
	grantDeclaration(api)
	api.On("GetUser", "user-1").Return(&model.User{Id: "user-1", Username: "casey"}, nil)
	require.Equal(t, http.StatusNoContent, declare(p, "user-1", declaration(app.URL)).Code)

	response, appErr := p.ExecuteCommand(nil, &model.CommandArgs{
		ChannelId: "channel-1", Command: "/collegium forget  post-9 ", TeamId: teamID, TriggerId: "trigger-1", UserId: "user-1",
	})
	require.Nil(t, appErr)
	require.Equal(t, forwardedCommand{ChannelID: "channel-1", TeamID: teamID, Text: "forget  post-9", TriggerID: "trigger-1", UserID: "user-1", UserName: "casey"}, received.forwardedCommand)
	require.Equal(t, "Bearer "+callbackToken, received.Authorization)
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

func TestDeclareSurfaceRecordsTheDeclarer(t *testing.T) {
	p, api := newTestPlugin(t)
	api.On("HasPermissionToTeam", "user-1", teamID, model.PermissionManageOwnSlashCommands).Return(true)
	api.On("KVSet", surfaceKey(teamID), mock.MatchedBy(func(raw []byte) bool {
		surface, err := decodeSurface(raw)
		return err == nil && surface.DeclaredBy == "user-1"
	})).Return(nil)
	api.On("RegisterCommand", mock.Anything).Return(nil)

	require.Equal(t, http.StatusNoContent, declare(p, "user-1", declaration("http://app:3000/commands")).Code)
}

func erase(p *Plugin, userID string, channelID string, before string) *httptest.ResponseRecorder {
	target := "/api/v1/teams/" + teamID + "/channels/" + channelID + "/posts"
	if before != "" {
		target += "?before=" + before
	}
	request := httptest.NewRequest(http.MethodDelete, target, nil)
	if userID != "" {
		request.Header.Set("Mattermost-User-Id", userID)
	}
	recorder := httptest.NewRecorder()
	p.ServeHTTP(nil, recorder, request)
	return recorder
}

// declaredByUser1 declares the team's surface as user-1, the one account the erase route answers
func declaredByUser1(t *testing.T, p *Plugin, api *plugintest.API) {
	t.Helper()
	grantDeclaration(api)
	require.Equal(t, http.StatusNoContent, declare(p, "user-1", declaration("http://app:3000/commands")).Code)
}

func expectRefusalLogged(api *plugintest.API) {
	api.On("LogWarn", "refused a post erasure", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything).Return()
}

func openChannel(id string) *model.Channel {
	return &model.Channel{Id: id, TeamId: teamID, Type: model.ChannelTypeOpen}
}

func TestErasePostsRequiresAuthentication(t *testing.T) {
	p, _ := newTestPlugin(t)
	require.Equal(t, http.StatusUnauthorized, erase(p, "", "channel-1", "notice").Code)
}

func TestErasePostsRequiresABoundary(t *testing.T) {
	p, _ := newTestPlugin(t)
	require.Equal(t, http.StatusBadRequest, erase(p, "user-1", "channel-1", "").Code)
}

func TestErasePostsRefusesAnUndeclaredTeam(t *testing.T) {
	p, _ := newTestPlugin(t)
	require.Equal(t, http.StatusNotFound, erase(p, "user-1", "channel-1", "notice").Code)
}

func TestErasePostsAnswersOnlyTheDeclarer(t *testing.T) {
	p, api := newTestPlugin(t)
	declaredByUser1(t, p, api)
	expectRefusalLogged(api)
	require.Equal(t, http.StatusForbidden, erase(p, "user-2", "channel-1", "notice").Code)
}

func TestErasePostsRefusesAChannelOffTheTeam(t *testing.T) {
	p, api := newTestPlugin(t)
	declaredByUser1(t, p, api)
	api.On("GetChannel", "channel-1").Return(&model.Channel{Id: "channel-1", TeamId: "team-2", Type: model.ChannelTypeOpen}, nil)
	require.Equal(t, http.StatusForbidden, erase(p, "user-1", "channel-1", "notice").Code)
}

func TestErasePostsRequiresTheBoundaryInTheChannel(t *testing.T) {
	p, api := newTestPlugin(t)
	declaredByUser1(t, p, api)
	api.On("GetChannel", "channel-1").Return(openChannel("channel-1"), nil)
	api.On("GetPost", "notice").Return(&model.Post{Id: "notice", ChannelId: "channel-2"}, nil)
	require.Equal(t, http.StatusBadRequest, erase(p, "user-1", "channel-1", "notice").Code)
}

func TestErasePostsDeletesEveryPostBeforeTheBoundaryAndReportsRefusals(t *testing.T) {
	p, api := newTestPlugin(t)
	declaredByUser1(t, p, api)
	api.On("GetChannel", "channel-1").Return(openChannel("channel-1"), nil)
	api.On("GetPost", "notice").Return(&model.Post{Id: "notice", ChannelId: "channel-1"}, nil)
	api.On("GetPostsBefore", "channel-1", "notice", 0, erasePageSize).Return(&model.PostList{Order: []string{"p3", "p2", "p1"}}, nil)
	api.On("DeletePost", "p3").Return(nil)
	api.On("DeletePost", "p2").Return(model.NewAppError("DeletePost", "gone with its root", nil, "", http.StatusNotFound))
	api.On("DeletePost", "p1").Return(model.NewAppError("DeletePost", "refused", nil, "", http.StatusInternalServerError))
	api.On("LogWarn", "a post refused deletion", "post_id", "p1", "error", mock.Anything).Return()

	response := erase(p, "user-1", "channel-1", "notice")
	require.Equal(t, http.StatusOK, response.Code)
	require.JSONEq(t, `{"deleted":2,"failed":1}`, response.Body.String())
}

func TestErasePostsCollectsEveryPageBeforeDeleting(t *testing.T) {
	p, api := newTestPlugin(t)
	declaredByUser1(t, p, api)
	api.On("GetChannel", "channel-1").Return(openChannel("channel-1"), nil)
	api.On("GetPost", "notice").Return(&model.Post{Id: "notice", ChannelId: "channel-1"}, nil)
	full := make([]string, erasePageSize)
	for i := range full {
		full[i] = fmt.Sprintf("p%d", i)
	}
	api.On("GetPostsBefore", "channel-1", "notice", 0, erasePageSize).Return(&model.PostList{Order: full}, nil)
	api.On("GetPostsBefore", "channel-1", "notice", 1, erasePageSize).Return(&model.PostList{Order: []string{"last"}}, nil)
	api.On("DeletePost", mock.Anything).Return(nil)

	response := erase(p, "user-1", "channel-1", "notice")
	require.Equal(t, http.StatusOK, response.Code)
	require.JSONEq(t, fmt.Sprintf(`{"deleted":%d,"failed":0}`, erasePageSize+1), response.Body.String())
	api.AssertNumberOfCalls(t, "DeletePost", erasePageSize+1)
}

func TestErasePostsReachesADirectMessage(t *testing.T) {
	p, api := newTestPlugin(t)
	declaredByUser1(t, p, api)
	api.On("GetChannel", "dm-1").Return(&model.Channel{Id: "dm-1", TeamId: "", Type: model.ChannelTypeDirect}, nil)
	api.On("GetPost", "notice").Return(&model.Post{Id: "notice", ChannelId: "dm-1"}, nil)
	api.On("GetPostsBefore", "dm-1", "notice", 0, erasePageSize).Return(&model.PostList{Order: []string{}}, nil)

	response := erase(p, "user-1", "dm-1", "notice")
	require.Equal(t, http.StatusOK, response.Code)
	require.JSONEq(t, `{"deleted":0,"failed":0}`, response.Body.String())
}

func TestOnActivateKeepsTheDeclarerForTheEraseRoute(t *testing.T) {
	p, api := newTestPlugin(t)
	api.On("KVList", 0, kvPageSize).Return([]string{surfaceKey(teamID)}, nil)
	api.On("KVGet", surfaceKey(teamID)).Return([]byte(`{"callbackToken":"t","callbackUrl":"http://app:3000/commands","commands":[{"trigger":"stop","hint":"","purpose":"Abort turns"}],"declaredBy":"user-1"}`), nil)
	api.On("RegisterCommand", mock.Anything).Return(nil)
	require.NoError(t, p.OnActivate())

	expectRefusalLogged(api)
	require.Equal(t, http.StatusForbidden, erase(p, "user-2", "channel-1", "notice").Code)

	api.On("GetChannel", "channel-1").Return(openChannel("channel-1"), nil)
	api.On("GetPost", "notice").Return(&model.Post{Id: "notice", ChannelId: "channel-1"}, nil)
	api.On("GetPostsBefore", "channel-1", "notice", 0, erasePageSize).Return(&model.PostList{Order: []string{}}, nil)
	require.Equal(t, http.StatusOK, erase(p, "user-1", "channel-1", "notice").Code)
}

func TestErasePostsRefusesASurfacePersistedWithoutADeclarer(t *testing.T) {
	p, api := newTestPlugin(t)
	api.On("KVList", 0, kvPageSize).Return([]string{surfaceKey(teamID)}, nil)
	api.On("KVGet", surfaceKey(teamID)).Return([]byte(declaration("http://app:3000/commands")), nil)
	api.On("RegisterCommand", mock.Anything).Return(nil)
	require.NoError(t, p.OnActivate())

	expectRefusalLogged(api)
	require.Equal(t, http.StatusForbidden, erase(p, "user-1", "channel-1", "notice").Code)
}
