const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");
const axios = require("axios");
const stream = require("stream");

const WEBHOOK_URL = "https://email-geneartor-production.up.railway.app/api/users/receive_email";
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

  // 🔥 FIXED onData with stream buffering
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
  
        // Process attachments with better error handling
        const attachments = [];
        for (const a of parsed.attachments || []) {
          try {
            if (a.content) {
              attachments.push({
                filename: a.filename || 'unnamed-file',
                contentType: a.contentType || 'application/octet-stream',
                size: a.size || 0,
                content: a.content.toString('base64') // Convert to base64
              });
            } else {
              console.warn('⚠️ Attachment has no content:', a.filename);
            }
          } catch (err) {
            console.error('❌ Error processing attachment:', err);
          }
        }
  
        const emailData = {
          from: parsed.from?.value[0]?.address || parsed.from?.text,
          to: parsed.to?.value.map(t => t.address) || [],
          subject: parsed.subject,
          text: parsed.text,
          html: parsed.html,
          date: parsed.date,
          attachments: attachments // This now includes base64 content
        };
  
        console.log('📤 Sending to webhook:', emailData.subject);
        console.log('📎 Attachment content present:', 
          emailData.attachments.length > 0 ? 
          emailData.attachments[0].content?.length > 0 : false);
  
        const response = await axios.post(WEBHOOK_URL, emailData, {
          timeout: 5000,
          maxBodyLength: Infinity, // Important for large attachments
          headers: {
            'Content-Type': 'application/json',
            'X-Email-Server': 'TempMailServer'
          }
        });
  
        console.log('✅ Webhook success:', response.status);
        callback();
      } catch (err) {
        console.error('❌ Error processing email:', err.message);
        if (err.response) {
          console.error('❌ Webhook response error:', err.response.data);
        }
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
