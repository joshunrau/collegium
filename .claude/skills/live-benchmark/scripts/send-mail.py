#!/usr/bin/env python3
"""Send one message through the mailbox an agent in config.json holds, to that same mailbox.

The test instance's mailbox is its own sender and receiver: mail sent here arrives as inbound mail
the agent's poll announces. Credentials are read from the repo's config.json and never printed.

  send-mail.py --agent tester-ds --subject "..." --body-file body.txt [--in-reply-to <Message-ID>]
"""

import argparse
import email.utils
import json
import pathlib
import smtplib
import sys
from email.message import EmailMessage

parser = argparse.ArgumentParser()
parser.add_argument('--agent', required=True)
parser.add_argument('--subject', required=True)
parser.add_argument('--body-file', required=True)
parser.add_argument('--from-name', default='Bakeoff Driver')
parser.add_argument('--in-reply-to')
parser.add_argument('--config', default=str(pathlib.Path(__file__).resolve().parents[4] / 'config.json'))
args = parser.parse_args()

config = json.load(open(args.config))
mail = config['agents'][args.agent]['toolSettings']['mail']['provider']
address, smtp = mail['address'], mail['smtp']

message = EmailMessage()
message['From'] = email.utils.formataddr((args.from_name, address))
message['To'] = address
message['Subject'] = args.subject
message['Date'] = email.utils.formatdate(localtime=True)
message['Message-ID'] = email.utils.make_msgid(domain=address.split('@')[1])
if args.in_reply_to:
    message['In-Reply-To'] = args.in_reply_to
    message['References'] = args.in_reply_to
message.set_content(open(args.body_file).read())

with smtplib.SMTP_SSL(smtp['host'], smtp['port']) as server:
    server.login(smtp['username'], smtp['password'])
    server.send_message(message)
print(f"sent {message['Message-ID']} subject={args.subject!r}", file=sys.stdout)
