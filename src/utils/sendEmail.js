import nodemailer from "nodemailer";

const sendEmail = async (options) => {
  // Konfigurasi Transporter (Gmail)
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.SMTP_EMAIL, // Email Gmail Anda
      pass: process.env.SMTP_PASSWORD, // App Password Gmail (Bukan password login biasa)
    },
  });

  const message = {
    from: `${process.env.FROM_NAME} <${process.env.SMTP_EMAIL}>`,
    to: options.email,
    subject: options.subject,
    text: options.message,
    html: options.html, // Tambahkan dukungan untuk HTML body
  };

  await transporter.sendMail(message);
};

export default sendEmail;