const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const stream = require("stream");

// ✅ Webhook URLs
const WEBHOOK_URLS = [
  "https://email-geneartor-production.up.railway.app/api/users/receive_email",
  "https://email-geneartor-development.up.railway.app/api/users/receive_email"
];

const SMTP_PORT = 25;
const ALLOWED_DOMAINS = ['tempemailbox.com']; // Add your domains here

const server = new SMTPServer({
  authOptional: true,

  onRcptTo(address, session, callback) {
    const domain = address.address.split('@')[1];
    if (ALLOWED_DOMAINS.includes(domain)) {
      console.log(`✅ Accepted recipient: ${address.address}`);
      callback();
    } else {
      console.log(`❌ Rejected recipient: ${address.address}`);
      callback(new Error(`550 Relay not allowed for ${domain}`));
    }
  },

  onConnect(session, callback) {
    console.log(`🔌 Connection from ${session.remoteAddress}`);
    callback();
  },

  onMailFrom(address, session, callback) {
    console.log(`📤 Mail from: ${address.address}`);
    callback();
  },

  // ✅ Updated onData with multiple webhooks
  onData(stream, session, callback) {
    console.log('📩 Processing incoming email...');

    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", async () => {
      const fullBuffer = Buffer.concat(chunks);

      try {
        const parsed = await simpleParser(fullBuffer, {
          skipHtmlToText: true,
          skipTextToHtml: true,
          skipImageLinks: true
        });

        console.log('📎 Attachments parsed:', parsed.attachments?.length);

        const attachments = parsed.attachments.map((a) => {
          return {
            filename: a.filename || 'unnamed-file',
            contentType: a.contentType || 'application/octet-stream',
            size: a.size || 0,
            content: a.content ? a.content.toString('base64') : null
          };
        }).filter(a => a.content); // Filter out empty attachments

        const emailData = {
          from: parsed.from?.value[0]?.address || parsed.from?.text,
          to: parsed.to?.value.map(t => t.address) || [],
          subject: parsed.subject,
          text: parsed.text,
          html: parsed.html,
          date: parsed.date,
          attachments: attachments
        };

        console.log('📤 Sending to webhooks:', emailData.subject);

        const webhookPromises = WEBHOOK_URLS.map(url =>
          axios.post(url, emailData, {
            timeout: 5000,
            headers: {
              'Content-Type': 'application/json',
              'X-Email-Server': 'TempMailServer'
            }
          }).then(res => {
            console.log(`✅ Webhook success (${url}):`, res.status);
          }).catch(err => {
            console.error(`❌ Webhook error (${url}):`, err.message);
            if (err.response) {
              console.error(`❌ Response error (${url}):`, err.response.data);
            }
          })
        );

        await Promise.allSettled(webhookPromises); // Allow all webhooks to run independently
        callback();
      } catch (err) {
        console.error('❌ Error processing email:', err.message);
        callback(new Error('450 Temporary processing failure'));
      }
    });
  },

  disabledCommands: ['AUTH'],
  logger: true
});

server.on('error', err => {
  console.error('❗ Server error:', err.message);
});

process.on('uncaughtException', err => {
  console.error('❗ Uncaught exception:', err);
});

server.listen(SMTP_PORT, '0.0.0.0', () => {
  console.log(`🚀 SMTP server running on port ${SMTP_PORT}`);
  console.log(`📨 Accepting emails for: ${ALLOWED_DOMAINS.join(', ')}`);
});
