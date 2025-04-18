const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");

const WEBHOOK_URL = "https://email-geneartor-production.up.railway.app/api/users/receive_email";
const SMTP_PORT = 25;
const ALLOWED_DOMAINS = ['tempemailbox.com'];

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
    console.log('Receiving email stream...');
  
    let rawData = Buffer.alloc(0);
  
    stream.on('data', (chunk) => {
      rawData = Buffer.concat([rawData, chunk]);
    });
  
    stream.on('end', async () => {
      console.log('Finished receiving email. Now parsing...');
  
      try {
        const parsed = await simpleParser(rawData, {
          skipHtmlToText: true,
          skipTextToHtml: true,
          skipImageLinks: true
        });
  
        console.log('Parsed attachments:', parsed.attachments);
  
        const attachmentsRaw = await Promise.all(
          parsed.attachments.map(async (a) => {
            if (!a.content) {
              console.warn(`Attachment ${a.filename} has no content, skipping`);
              return null;
            }
  
            return {
              filename: a.filename || 'unnamed-file',
              contentType: a.contentType || 'application/octet-stream',
              size: a.size || 0,
              content: a.content.toString('base64')
            };
          })
        );
  
        const attachments = attachmentsRaw.filter(a => a !== null);
  
        const emailData = {
          from: parsed.from?.value[0]?.address || parsed.from?.text,
          to: parsed.to?.value.map(t => t.address) || [],
          subject: parsed.subject,
          text: parsed.text,
          html: parsed.html,
          date: parsed.date,
          attachments: attachments
        };
  
        console.log('Sending parsed email to webhook...');
  
        await axios.post(WEBHOOK_URL, emailData, {
          timeout: 5000,
          headers: {
            'Content-Type': 'application/json',
            'X-Email-Server': 'TempMailServer'
          }
        });
  
        callback();
      } catch (err) {
        console.error('Error during parsing or webhook:', err);
        callback(new Error('450 Temporary processing failure'));
      }
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
  console.log(`Accepting emails for domains: ${ALLOWED_DOMAINS.join(', ')}`);
});
