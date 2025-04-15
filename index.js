// index.js
const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");
require("dotenv").config();

const server = new SMTPServer({
  authOptional: true,
  onData(stream, session, callback) {
    simpleParser(stream)
      .then(parsed => {
        const { from, to, subject, text, html, attachments } = parsed;

        // Send this data to your webhook
        axios.post(process.env.WEBHOOK_URL, {
          from: from.text,
          to,
          subject,
          text,
          html,
          attachments: attachments.map(a => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
            content: a.content.toString("base64"), // optional
          })),
        }).then(() => {
          console.log("Email forwarded to webhook");
          callback();
        }).catch(err => {
          console.error("Failed to post to webhook", err);
          callback(err);
        });
      })
      .catch(err => {
        console.error("Error parsing email", err);
        callback(err);
      });
  },
  disabledCommands: ['AUTH']
});

const PORT = process.env.SMTP_PORT || 2525;

server.listen(PORT, () => {
  console.log(`SMTP Server listening on port ${PORT}`);
});
