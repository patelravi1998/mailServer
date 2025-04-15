const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");

// Hardcoded configuration
const WEBHOOK_URL = "https://email-geneartor-production.up.railway.app/api/users/receive_email";
const SMTP_PORT = 2525; // Changed to 2525 since Railway needs this port

const server = new SMTPServer({
  authOptional: true,
  onConnect(session, callback) {
    console.log(`New connection from ${session.remoteAddress}`);
    callback();
  },
  onMailFrom(address, session, callback) {
    console.log(`Mail from: ${address.address}`);
    callback();
  },
  onRcptTo(address, session, callback) {
    console.log(`Mail to: ${address.address}`);
    callback();
  },
  onData(stream, session, callback) {
    console.log('Processing email...');
    
    simpleParser(stream)
      .then(parsed => {
        const { from, to, subject, text, html, attachments } = parsed;
        console.log(`Received email to ${to.value[0].address}`);

        // Hardcoded webhook call
        axios.post(WEBHOOK_URL, {
          from: from.text,
          to: to.value.map(t => t.address),
          subject,
          text,
          html,
          attachments: attachments.map(a => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size
          })),
        })
        .then(response => {
          console.log('Webhook response:', response.status, response.data);
          callback();
        })
        .catch(err => {
          console.error('Webhook error:', err.response?.data || err.message);
          callback(err);
        });
      })
      .catch(err => {
        console.error('Parsing error:', err);
        callback(err);
      });
  },
  disabledCommands: ['AUTH']
});

server.listen(SMTP_PORT, () => {
  console.log(`SMTP Server running on port ${SMTP_PORT}`);
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
});

// Add error handling
server.on('error', err => {
  console.error('Server error:', err);
});