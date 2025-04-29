const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const stream = require("stream");

const WEBHOOK_URL = "https://email-geneartor-production.up.railway.app/api/users/receive_email";
const SMTP_PORT = 25;
const ALLOWED_DOMAINS = ['anonemail.space']; // Add your domains here

const server = new SMTPServer({
  authOptional: true,
  onRcptTo(address, session, callback) {
    const domain = address.address.split('@')[1];
    if (ALLOWED_DOMAINS.includes(domain)) {
      return callback(); // allow
    } else {
      console.log(`❌ Relay not allowed for ${address.address}`);
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

  // 🔥 FIXED onData with stream buffering
  onData(stream, session, callback) {
    console.log('📩 Processing incoming email...');

    // Buffer the stream first before passing to simpleParser
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', async () => {
      const fullBuffer = Buffer.concat(chunks);

      try {
        const parsed = await simpleParser(fullBuffer, {
          skipHtmlToText: true,
          skipTextToHtml: true,
          skipImageLinks: true
        });

        console.log('📎 Attachments parsed:', parsed.attachments?.length);

        const attachments = (parsed.attachments || []).map((a) => {
          return {
            filename: a.filename || 'unnamed-file',
            contentType: a.contentType || 'application/octet-stream',
            size: a.size || 0,
            content: a.content ? a.content.toString('base64') : null
          };
        }).filter(a => a.content); // Filter out if content missing

        const emailData = {
          from: parsed.from?.value[0]?.address || parsed.from?.text,
          to: parsed.to?.value.map(t => t.address) || [],
          subject: parsed.subject,
          text: parsed.text,
          html: parsed.html,
          date: parsed.date,
          attachments: attachments
        };

        console.log(`📤 Sending to webhook: ${emailData.subject}`);

        const response = await axios.post(WEBHOOK_URL, emailData, {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
            'X-Email-Server': 'TempMailServer'
          }
        });

        console.log(`✅ Webhook success: ${response.status}`);
        callback();
      } catch (err) {
        console.error(`❌ Error processing email: ${err.message}`);
        if (err.response) {
          console.error(`❌ Webhook response error: ${JSON.stringify(err.response.data)}`);
        }
        callback(new Error('450 Temporary processing failure'));
      }
    });
  },

  disabledCommands: ['AUTH'],
  logger: true
});

server.on('error', (err) => {
  console.error(`❗ Server error: ${err.message}`);
});

process.on('uncaughtException', (err) => {
  console.error(`❗ Uncaught exception: ${err}`);
});

server.listen(SMTP_PORT, '0.0.0.0', () => {
  console.log(`🚀 SMTP server running on port ${SMTP_PORT}`);
  console.log(`📨 Accepting emails for: ${ALLOWED_DOMAINS.join(', ')}`);
});
