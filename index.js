const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");

const WEBHOOK_URL = "https://email-geneartor-production.up.railway.app/api/users/receive_email";
const SMTP_PORT = 25;
const ALLOWED_DOMAINS = ['tempemailbox.com']; // Add your domains here

const server = new SMTPServer({
  authOptional: true,
  // Critical fix: Add domain validation
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
// In your SMTP server code (where you have onData handler)
onData(stream, session, callback) {
  console.log('Processing email...');
  
  simpleParser(stream, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true
  })
  .then(async (parsed) => {
    console.log('Raw attachments received:', parsed.attachments);
    
    const attachments = await Promise.all(
      parsed.attachments.map(async (a) => {
        console.log('Processing attachment:', a.filename, 'Size:', a.size, 'Has content:', !!a.content);
        return {
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
          content: a.content ? a.content.toString('base64') : null
        };
      })
    );

    const emailData = {
      from: parsed.from?.value[0]?.address || parsed.from?.text,
      to: parsed.to?.value.map(t => t.address) || [],
      subject: parsed.subject,
      text: parsed.text,
      html: parsed.html,
      date: parsed.date,
      attachments: attachments
    };

    console.log('Sending to webhook:', emailData.subject);
    
    return axios.post(WEBHOOK_URL, emailData, {
      timeout: 5000,
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
    if (err.response) {
      console.error('Webhook response error:', err.response.data);
    }
    callback(new Error('450 Temporary processing failure'));
  });
},
  disabledCommands: ['AUTH'],
  logger: true
});

// Enhanced error handling
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