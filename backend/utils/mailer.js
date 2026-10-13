/**
 * Shared SMTP mailer, built from the EMAIL_* vars in .env
 * (EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_PASS).
 * Any scheduled/report job that needs to email someone should go
 * through sendMail() here rather than creating its own transporter.
 */
const nodemailer = require("nodemailer");

let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return transporter;
};

/**
 * @param {{ to: string|string[], cc?: string|string[], bcc?: string|string[], subject: string, html?: string, text?: string, attachments?: object[] }} options
 */
const sendMail = async ({ to, cc, bcc, subject, html, text, attachments }) => {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error("Email is not configured (missing EMAIL_HOST/EMAIL_USER/EMAIL_PASS in .env).");
  }
  return getTransporter().sendMail({
    from: `"Automation NOC" <${process.env.EMAIL_USER}>`,
    to,
    cc,
    bcc,
    subject,
    html,
    text,
    attachments,
  });
};

module.exports = { sendMail };
