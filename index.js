const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");

const SMTP_PORT = 25;
const ALLOWED_DOMAINS = ['tempemailbox.com']; // Add multiple domains if needed
const WEBHOOKS = [
  "https://email-geneartor-production.up.railway.app/api/users/receive_email",
  "https://email-geneartor-development.up.railway.app/api/users/receive_email"
];

const server = new SMTPServer({
  authOptional: true,
  onRcptTo(address, session, callback) {
    const domain = address.address.split('@')[1];
    if (ALLOWED_DOMAINS.includes(domain)) {
      console.log(`Accepted recipient: ${address.address}`);
      callback();
    } else {
      console.log(`Rejected recipient: ${address.address}`);
      callback(new Error(`550 Relay not allowed for ${domain}`));
    }
  },
  onConnect(session, callback) {
    console.log(`Connection from ${session.remoteAddress}`);
    callback();
  },
  onMailFrom(address, session, callback) {
    console.log(`Mail from: ${address.address}`);
    callback();
  },
  onData(stream, session, callback) {
    console.log('Processing email...');

    simpleParser(stream, {
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true
    })
    .then(parsed => {
      const emailData = {
        from: parsed.from?.value[0]?.address || parsed.from?.text,
        to: parsed.to?.value.map(t => t.address) || [],
        subject: parsed.subject,
        text: parsed.text,
        html: parsed.html,
        date: parsed.date,
        attachments: parsed.attachments.map(a => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size
        }))
      };

      console.log('Sending to webhooks:', emailData.subject);

      // Send to all webhooks in parallel
      return Promise.all(
        WEBHOOKS.map(url =>
          axios.post(url, emailData, {
            timeout: 5000,
            headers: {
              'Content-Type': 'application/json',
              'X-Email-Server': 'TempMailServer'
            }
          }).then(response => {
            console.log(`✅ Webhook ${url} success: ${response.status}`);
          }).catch(error => {
            console.error(`❌ Webhook ${url} failed:`, error.message);
          })
        )
      );
    })
    .then(() => callback())
    .catch(err => {
      console.error('Parser/Error:', err.message);
      callback(new Error('450 Temporary processing failure'));
    });
  },
  disabledCommands: ['AUTH'],
  logger: true
});

server.on('error', err => {
  console.error('Server error:', err.message);
});

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
});

server.listen(SMTP_PORT, '0.0.0.0', () => {
  console.log(`SMTP server running on port ${SMTP_PORT}`);
  console.log(`Accepting emails for: ${ALLOWED_DOMAINS.join(', ')}`);
});
