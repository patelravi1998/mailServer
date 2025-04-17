const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const { Buffer } = require("buffer");

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
    console.log('Processing email...');
    
    simpleParser(stream, {
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true
    })
    .then(async (parsed) => {
      console.log('Processing attachments...');
      
      const attachments = await Promise.all(
        parsed.attachments.map(async (a) => {
          try {
            if (!a.content) {
              console.warn(`Attachment ${a.filename} has no content, skipping`);
              return null;
            }

            const content = a.content instanceof Buffer ? a.content : Buffer.from(a.content);
            if (content.length === 0) {
              console.warn(`Attachment ${a.filename} has zero-length content`);
              return null;
            }

            return {
              filename: a.filename || 'unnamed-file',
              contentType: a.contentType || 'application/octet-stream',
              size: content.length,
              content: content.toString('base64')
            };
          } catch (err) {
            console.error(`Error processing attachment ${a.filename}:`, err);
            return null;
          }
        })
      );

      const validAttachments = attachments.filter(a => a !== null);
      
      const emailData = {
        from: parsed.from?.value[0]?.address || parsed.from?.text,
        to: parsed.to?.value.map(t => t.address) || [],
        subject: parsed.subject,
        text: parsed.text,
        html: parsed.html,
        date: parsed.date,
        attachments: validAttachments
      };

      console.log(`Sending email with ${validAttachments.length} attachments`);
      
      return axios.post(WEBHOOK_URL, emailData, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'X-Email-Server': 'TempMailServer'
        }
      });
    })
    .then(response => {
      console.log('Webhook success:', response.status);
      callback();
    })
    .catch(err => {
      console.error('Error:', err.message);
      callback(new Error('450 Temporary processing failure'));
    });
  },
  disabledCommands: ['AUTH'],
  logger: true
});

server.on('error', err => {
  console.error('Server error:', err);
});

process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
});

server.listen(SMTP_PORT, '0.0.0.0', () => {
  console.log(`SMTP server running on port ${SMTP_PORT}`);
});