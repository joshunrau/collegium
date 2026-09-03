/**
 * Real messages captured on 2026-09-02, redacted. Each is the part the pipeline reads: the HTML part
 * where one exists, otherwise the plain text. HTML is raw so markdown escapes and quote prefixes
 * survive exactly as the client sent them; the narrow no-break space Apple and Outlook put before
 * AM/PM is written as an entity or escape so it survives the linter.
 */

/** Apple Mail replying to a plain-text message: text/plain only. Attribution "On <date>, at <time>, <who> wrote:" then ">" lines. */
export const APPLE_REPLY_PLAIN_TEXT = `
This is a test reply

> On Sep 2, 2026, at 5:00\u202FPM, apple@example.com wrote:
>
> This was sent from Apple mail
`;

/** Apple Mail replying to an Outlook HTML message: blockquote type="cite" behind an attribution div; id lineBreakAtBeginningOfMessage. */
export const APPLE_REPLY_HTML_HTML = String.raw`
<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body style="overflow-wrap: break-word; -webkit-nbsp-mode: space; line-break: after-white-space;"><span style="caret-color: rgb(0, 0, 0); color: rgb(0, 0, 0);">This is a test reply</span><br id="lineBreakAtBeginningOfMessage"><div><br><blockquote type="cite"><div>On Sep 2, 2026, at 4:59&#x202F;PM, Jane Doe &lt;outlook@example.com&gt; wrote:</div><br class="Apple-interchange-newline"><div>

<div>
<div style="font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt;" dir="ltr">
This was sent from outlook</div>
</div>

</div></blockquote></div><br></body></html>
`;

/** Apple Mail forwarding a Gmail forward: "Begin forwarded message:" then bold From/Subject/Date/To inside blockquote type="cite"; wraps gmail-forward and gmail-reply and apple-reply-plain. */
export const APPLE_FORWARD_HTML = String.raw`
<html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body style="overflow-wrap: break-word; -webkit-nbsp-mode: space; line-break: after-white-space;">See this<br id="lineBreakAtBeginningOfMessage"><div><br><blockquote type="cite"><div>Begin forwarded message:</div><br class="Apple-interchange-newline"><div style="margin-top: 0px; margin-right: 0px; margin-bottom: 0px; margin-left: 0px;"><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif; color:rgba(0, 0, 0, 1.0);"><b>From: </b></span><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif;">Jane Doe &lt;gmail@example.com&gt;<br></span></div><div style="margin-top: 0px; margin-right: 0px; margin-bottom: 0px; margin-left: 0px;"><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif; color:rgba(0, 0, 0, 1.0);"><b>Subject: </b></span><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif;"><b>Fwd: Gmail Test</b><br></span></div><div style="margin-top: 0px; margin-right: 0px; margin-bottom: 0px; margin-left: 0px;"><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif; color:rgba(0, 0, 0, 1.0);"><b>Date: </b></span><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif;">September 2, 2026 at 5:05:57&#x202F;PM EDT<br></span></div><div style="margin-top: 0px; margin-right: 0px; margin-bottom: 0px; margin-left: 0px;"><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif; color:rgba(0, 0, 0, 1.0);"><b>To: </b></span><span style="font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif;">apple@example.com<br></span></div><br><div><div dir="ltr">here is the whole chain forwarded<div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <b class="gmail_sendername" dir="auto">Jane Doe</b> <span dir="auto">&lt;<a href="mailto:gmail@example.com">gmail@example.com</a>&gt;</span><br>Date: Wed, Sep 2, 2026 at 5:05&#x202F;PM<br>Subject: Re: Gmail Test<br>To:  &lt;<a href="mailto:apple@example.com">apple@example.com</a>&gt;<br></div><br><br><div dir="ltr">here is a reply back</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Wed, Sep 2, 2026 at 5:04&#x202F;PM &lt;<a href="mailto:apple@example.com" target="_blank">apple@example.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">This is a test reply<br>
<br>
&gt; On Sep 2, 2026, at 4:59&#x202F;PM, Jane Doe &lt;<a href="mailto:gmail@example.com" target="_blank">gmail@example.com</a>&gt; wrote:<br>
&gt; <br>
&gt; This was sent from gmail<br>
<br>
</blockquote></div>
</div></div></div>
</div></blockquote></div><br></body></html>
`;

/** Gmail replying to an Apple plain-text reply: div.gmail_quote_container > div.gmail_attr ("On <date> <who> wrote:") + blockquote.gmail_quote. Apple's literal ">" quoting inside becomes text. */
export const GMAIL_REPLY_HTML = String.raw`
<div dir="ltr">here is a reply back</div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Wed, Sep 2, 2026 at 5:04&#x202F;PM &lt;<a href="mailto:apple@example.com">apple@example.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">This is a test reply<br>
<br>
&gt; On Sep 2, 2026, at 4:59&#x202F;PM, Jane Doe &lt;<a href="mailto:gmail@example.com" target="_blank">gmail@example.com</a>&gt; wrote:<br>
&gt; <br>
&gt; This was sent from gmail<br>
<br>
</blockquote></div>
`;

/** Gmail forwarding: "---------- Forwarded message ---------" then From/Date/Subject/To (unbolded labels, bold name) inside gmail_quote; wraps gmail-reply. */
export const GMAIL_FORWARD_HTML = String.raw`
<div dir="ltr">here is the whole chain forwarded<div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <b class="gmail_sendername" dir="auto">Jane Doe</b> <span dir="auto">&lt;<a href="mailto:gmail@example.com">gmail@example.com</a>&gt;</span><br>Date: Wed, Sep 2, 2026 at 5:05&#x202F;PM<br>Subject: Re: Gmail Test<br>To:  &lt;<a href="mailto:apple@example.com">apple@example.com</a>&gt;<br></div><br><br><div dir="ltr">here is a reply back</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Wed, Sep 2, 2026 at 5:04&#x202F;PM &lt;<a href="mailto:apple@example.com" target="_blank">apple@example.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">This is a test reply<br>
<br>
&gt; On Sep 2, 2026, at 4:59&#x202F;PM, Jane Doe &lt;<a href="mailto:gmail@example.com" target="_blank">gmail@example.com</a>&gt; wrote:<br>
&gt; <br>
&gt; This was sent from gmail<br>
<br>
</blockquote></div>
</div></div></div>
`;

/** Gmail replying to apple-forward: three levels of gmail_quote, Apple forward headers survive as bold labels inside. */
export const GMAIL_REPLY_DEEP_HTML = String.raw`
<div dir="ltr">now I will reply to the forwarded message</div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Wed, Sep 2, 2026 at 5:05&#x202F;PM Jane Doe &lt;<a href="mailto:gmail@example.com">gmail@example.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div dir="ltr">here is the whole chain forwarded<div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <b class="gmail_sendername" dir="auto">Jane Doe</b> <span dir="auto">&lt;<a href="mailto:gmail@example.com" target="_blank">gmail@example.com</a>&gt;</span><br>Date: Wed, Sep 2, 2026 at 5:05&#x202F;PM<br>Subject: Re: Gmail Test<br>To:  &lt;<a href="mailto:apple@example.com" target="_blank">apple@example.com</a>&gt;<br></div><br><br><div dir="ltr">here is a reply back</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Wed, Sep 2, 2026 at 5:04&#x202F;PM &lt;<a href="mailto:apple@example.com" target="_blank">apple@example.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">This is a test reply<br>
<br>
&gt; On Sep 2, 2026, at 4:59&#x202F;PM, Jane Doe &lt;<a href="mailto:gmail@example.com" target="_blank">gmail@example.com</a>&gt; wrote:<br>
&gt; <br>
&gt; This was sent from gmail<br>
<br>
</blockquote></div>
</div></div></div>
</blockquote></div>
`;

/** New Outlook for Mac reply to a reply: flat chain, one div#mail-editor-reference-message-container per message with bold From/Date/To/Subject, body in #mail-editor-reference-message-body; innermost Apple quote is a plain <blockquote> (type="cite" stripped). */
export const OUTLOOK_MAC_REPLY_TO_REPLY_HTML = String.raw`
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
</head>
<body>
<div style="font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);" dir="ltr">
And a reply to a reply</div>
<div style="font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);" dir="ltr">
<br>
</div>
<div id="mail-editor-reference-message-container">
<div style="padding: 3pt 0in 0in; border-width: 1pt medium medium; border-style: solid none none; border-color: rgb(181, 196, 223) currentcolor currentcolor;">
<div style="text-align: left; font-family: Aptos; font-size: 12pt; color: black;">
<b>From: </b>Jane Doe &lt;outlook@example.com&gt;<br>
<b>Date: </b>Wednesday, September 2, 2026 at 5:05&#x202F;PM<br>
<b>To: </b>apple@example.com &lt;apple@example.com&gt;<br>
<b>Subject: </b>Re: Outlook Test<br>
<br>
</div>
</div>
<div id="mail-editor-reference-message-body">
<div class="ms-outlook-mobile-reference-message skipProofing" dir="ltr"></div>
<div class="ms-outlook-mobile-reference-message skipProofing" style="direction: ltr; font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">
Here is a reply back</div>
<div class="ms-outlook-mobile-reference-message skipProofing" style="direction: ltr; font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">
<br>
</div>
<div id="mail-editor-reference-message-container">
<div style="padding: 3pt 0in 0in; border-width: 1pt medium medium; border-style: solid none none; border-color: rgb(181, 196, 223) currentcolor currentcolor;">
<div style="text-align: left; font-family: Aptos; font-size: 12pt; color: black;">
<b>From: </b>apple@example.com &lt;apple@example.com&gt;<br>
<b>Date: </b>Wednesday, September 2, 2026 at 5:04&#x202F;PM<br>
<b>To: </b>Jane Doe &lt;outlook@example.com&gt;<br>
<b>Subject: </b>Re: Outlook Test<br>
<br>
</div>
</div>
<div id="mail-editor-reference-message-body">
<div class="ms-outlook-mobile-reference-message skipProofing" style="color: rgb(0, 0, 0);">
This is a test reply</div>
<div class="ms-outlook-mobile-reference-message skipProofing" style="direction: ltr;">
<br>
</div>
<blockquote>
<div class="ms-outlook-mobile-reference-message skipProofing">On Sep 2, 2026, at 4:59&#x202F;PM, Jane Doe &lt;outlook@example.com&gt; wrote:</div>
<div class="ms-outlook-mobile-reference-message skipProofing" style="direction: ltr;">
<br>
</div>
<div class="ms-outlook-mobile-reference-message skipProofing" style="direction: ltr; font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt;">
This was sent from outlook</div>
</blockquote>
<div class="ms-outlook-mobile-reference-message skipProofing" style="direction: ltr;">
<br>
</div>
</div>
</div>
</div>
</div>
</body>
</html>
`;

/** New Outlook for Mac, the chain in the screenshot: two flat header blocks. */
export const OUTLOOK_MAC_REPLY_SARAH_HTML = String.raw`
<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
</head>
<body>
<div style="font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);" dir="ltr">
Test</div>
<div style="font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);" dir="ltr">
<br>
</div>
<div id="mail-editor-reference-message-container">
<div style="padding: 3pt 0in 0in; border-width: 1pt medium medium; border-style: solid none none; border-color: rgb(181, 196, 223) currentcolor currentcolor;">
<div style="text-align: left; font-family: Aptos; font-size: 12pt; color: black;">
<b>From: </b>Jane Doe &lt;outlook@example.com&gt;<br>
<b>Date: </b>Wednesday, September 2, 2026 at 11:03&#x202F;AM<br>
<b>To: </b>zoho@example.com &lt;zoho@example.com&gt;<br>
<b>Subject: </b>Re: Mail test — Sarah<br>
<br>
</div>
</div>
<div id="mail-editor-reference-message-body">
<div class="ms-outlook-mobile-reference-message skipProofing" dir="ltr"></div>
<div class="ms-outlook-mobile-reference-message skipProofing" style="direction: ltr; font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">
Yes, it works</div>
<div class="ms-outlook-mobile-reference-message skipProofing" style="direction: ltr; font-family: Aptos, Arial, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);">
<br>
</div>
<div id="mail-editor-reference-message-container">
<div style="padding: 3pt 0in 0in; border-width: 1pt medium medium; border-style: solid none none; border-color: rgb(181, 196, 223) currentcolor currentcolor;">
<div style="text-align: left; font-family: Aptos; font-size: 12pt; color: black;">
<b>From: </b>zoho@example.com &lt;zoho@example.com&gt;<br>
<b>Date: </b>Wednesday, September 2, 2026 at 11:02&#x202F;AM<br>
<b>To: </b>Jane Doe &lt;outlook@example.com&gt;<br>
<b>Subject: </b>Mail test — Sarah<br>
<br>
</div>
</div>
<div id="mail-editor-reference-message-body">
<div class="ms-outlook-mobile-reference-message skipProofing" dir="ltr">
<meta name="Generator" content="Microsoft Exchange Server">
</div>
<div class="PlainText" style="font-size: 11pt;">Hi Jane,<br>
<br>
This is a quick test to confirm that my mail is working. If you're receiving this, everything is functioning as expected.<br>
<br>
Best,<br>
Sarah Foster</div>
</div>
</div>
</div>
</div>
</body>
</html>
`;

/** Zoho replying to an OWA reply: div.zmail_extra_hr + div.zmail_extra, attribution block From/To/Date/Subject (RFC 2822 date with numeric offset), blockquote#blockquote_zmail. Inside: OWA reply = hr + div#x_<hash>divRplyFwdMsg with bold From/Sent/To/Subject (ids prefixed by Zoho). Zoho text part has no ">" prefixes; OWA text part inserts "mailto:" into addresses; Zoho signature is "Sent using {0}". */
export const ZOHO_REPLY_WRAPPING_OWA_REPLY_HTML = String.raw`
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body><div style="font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 10pt;"><div>Respond</div><div><br></div><div id="Zm-_Id_-Sgn" data-sigid="547583000000002016" data-zbluepencil-ignore="true"><p style="" unicode=""><span class="colour" style="color:rgb(42, 42, 42)">Sent using <a style="color:#598fde;" href="{0}" target="_blank">Zoho Mail</a></span><br></p></div><div><br></div><div class="zmail_extra_hr" style="border-top: 1px solid rgb(204, 204, 204); height: 0px; margin-top: 10px; margin-bottom: 10px; line-height: 0px;"><br></div><div class="zmail_extra" data-zbluepencil-ignore="true"><div><br></div><div id="Zm-_Id_-Sgn1">From: Jane Doe &lt;outlook@example.com&gt;<br>To: &quot;Jane Doe&quot;&lt;zoho@example.com&gt;<br>Date: Wed, 02 Sep 2026 17:25:13 -0400<br>Subject: Re: Test<br></div><div><br></div><blockquote style="margin: 0px;" id="blockquote_zmail"><div dir="ltr" class="zm_1262303314237871504_parse_4887134316948185740"><div class="x_1811877160elementToProof" style="font-family: Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0)"><br></div><div id="x_1811877160appendonsend"><br></div><div class="x_1811877160elementToProof" style="font-family: Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0)">Hello from outlook<br></div><hr style="display: inline-block; width: 98%"><div id="x_1811877160divRplyFwdMsg"><div style="direction: ltr; font-family: Calibri, sans-serif; font-size: 11pt; color: rgb(0, 0, 0)"><b>From:</b> Jane Doe &lt;<a href="mailto:zoho@example.com" target="_blank">zoho@example.com</a>&gt;<br> <b>Sent:</b> September 2, 2026 5:22 PM<br> <b>To:</b> Jane Doe &lt;<a href="mailto:outlook@example.com" target="_blank">outlook@example.com</a>&gt;<br> <b>Subject:</b> Test</div><div style="direction: ltr">&nbsp;<br></div></div><div style="font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 10pt"><br></div><div style="font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 10pt"><br></div><div style="font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 10pt"><br></div><div style="font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 10pt"><b>Hello World<br> </b><i><u><br> This is html</u></i></div><div style="font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 10pt"><br></div><div><br></div></div></blockquote></div><div><br></div></div><br></body></html>
`;

/** Zoho replying to an OWA forward ("Fw:") of apple-forward: OWA uses the same divRplyFwdMsg block for forwards; OWA stripped every gmail_quote class and replaced them with generated OWA ids; Apple blockquote lost type="cite". Deepest mixed chain in the corpus. */
export const ZOHO_REPLY_WRAPPING_OWA_FORWARD_HTML = String.raw`
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN"><html><head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body><div style="font-family: Verdana, Arial, Helvetica, sans-serif; font-size: 10pt;"><div>Respond</div><div><br></div><div id="Zm-_Id_-Sgn" data-sigid="547583000000002016" data-zbluepencil-ignore="true"><p style="" unicode=""><span class="colour" style="color:rgb(42, 42, 42)">Sent using <a style="color:#598fde;" href="{0}" target="_blank">Zoho Mail</a></span><br></p></div><div><br></div><div class="zmail_extra_hr" style="border-top: 1px solid rgb(204, 204, 204); height: 0px; margin-top: 10px; margin-bottom: 10px; line-height: 0px;"><br></div><div class="zmail_extra" data-zbluepencil-ignore="true"><div><br></div><div id="Zm-_Id_-Sgn1">From: Jane Doe &lt;outlook@example.com&gt;<br>To: &quot;Jane Doe&quot;&lt;zoho@example.com&gt;<br>Date: Wed, 02 Sep 2026 17:26:03 -0400<br>Subject: Fw: Gmail Test<br></div><div><br></div><blockquote style="margin: 0px;" id="blockquote_zmail"><div dir="ltr" class="zm_6625650284059619287_parse_2872451599346682310"><div class="x_1132744966elementToProof" style="font-family: Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0)"><br></div><div id="x_1132744966appendonsend"><br></div><div class="x_1132744966elementToProof" style="font-family: Aptos, Aptos_EmbeddedFont, Aptos_MSFontService, Calibri, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0)">I will also forward oyu this<br></div><hr style="display: inline-block; width: 98%"><div id="x_1132744966divRplyFwdMsg"><div style="direction: ltr; font-family: Calibri, sans-serif; font-size: 11pt; color: rgb(0, 0, 0)"><b>From:</b> <a href="mailto:apple@example.com" target="_blank">apple@example.com</a> &lt;<a href="mailto:apple@example.com" target="_blank">apple@example.com</a>&gt;<br> <b>Sent:</b> September 2, 2026 5:06 PM<br> <b>To:</b> Jane Doe &lt;<a href="mailto:outlook@example.com" target="_blank">outlook@example.com</a>&gt;<br> <b>Subject:</b> Fwd: Gmail Test</div><div style="direction: ltr">&nbsp;<br></div></div><div>See this<br></div><div><br></div><blockquote><div>Begin forwarded message:<br></div><div><br></div><div style="margin: 0px; font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif"><span class="colour" style="color:rgb(0, 0, 0)"><b>From: </b></span>Jane Doe &lt;<a href="mailto:gmail@example.com" target="_blank">gmail@example.com</a>&gt;<br></div><div style="margin: 0px; font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif"><span class="colour" style="color:rgb(0, 0, 0)"><b>Subject: </b></span><b>Fwd: Gmail Test</b><br></div><div style="margin: 0px; font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif"><span class="colour" style="color:rgb(0, 0, 0)"><b>Date: </b></span>September 2, 2026 at 5:05:57&#x202F;PM EDT<br></div><div style="margin: 0px; font-family: -webkit-system-font, Helvetica Neue, Helvetica, sans-serif"><span class="colour" style="color:rgb(0, 0, 0)"><b>To: </b></span><a href="mailto:apple@example.com" target="_blank">apple@example.com</a><br></div><div><br></div><div style="direction: ltr">here is the whole chain forwarded<br></div><div style="direction: ltr"><br></div><div style="direction: ltr">---------- Forwarded message ---------<br> From: <b>Jane Doe</b> &lt;<a href="mailto:gmail@example.com" id="x_1132744966OWAc13ea23c-ceb8-2a3a-17cc-e6fa6d3012e5" class="x_1132744966OWAAutoLink" target="_blank">gmail@example.com</a>&gt;<br> Date: Wed, Sep 2, 2026 at 5:05&#x202F;PM<br> Subject: Re: Gmail Test<br> To: &lt;<a href="mailto:apple@example.com" id="x_1132744966OWAa867548d-610e-1c07-c17c-be7249972093" class="x_1132744966OWAAutoLink" target="_blank">apple@example.com</a>&gt;</div><div style="direction: ltr"><br><br></div><div style="direction: ltr">here is a reply back<br></div><div style="direction: ltr"><br></div><div style="direction: ltr">On Wed, Sep 2, 2026 at 5:04&#x202F;PM &lt;<a href="mailto:apple@example.com" id="x_1132744966OWA44453af8-ad4e-b23f-fd1d-29330a55aab9" class="x_1132744966OWAAutoLink" target="_blank">apple@example.com</a>&gt; wrote:<br></div><blockquote style="margin: 0px 0px 0px 0.8ex; padding-left: 1ex; border-left: 1px solid rgb(204, 204, 204)"><div style="direction: ltr">This is a test reply<br> <br> &gt; On Sep 2, 2026, at 4:59&#x202F;PM, Jane Doe &lt;<a href="mailto:gmail@example.com" id="x_1132744966OWA84a2e181-dafb-0c2d-934f-dae30f0eae68" class="x_1132744966OWAAutoLink" target="_blank">gmail@example.com</a>&gt; wrote:<br> &gt;<br> &gt; This was sent from gmail<br> <br></div></blockquote></blockquote><div><br></div></div></blockquote></div><div><br></div></div><br></body></html>
`;
