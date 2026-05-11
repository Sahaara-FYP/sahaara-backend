import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

// Use a verified domain or the default Resend onboarding email
const DEFAULT_FROM = process.env.EMAIL_FROM || "onboarding@resend.dev";

export const sendVerificationEmail = async (email: string, token: string) => {
  const verifyUrl = `${process.env.BACKEND_URL}/auth/verify-email?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: `Sahaara Community <${DEFAULT_FROM}>`,
      to: email,
      subject: "Welcome to Sahaara! Just one last step...",
      html: `
      <div style="background-color: #020617; padding: 40px 20px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; text-align: center;">
        <div style="max-width: 600px; margin: auto; background-color: #0F172A; border-radius: 24px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
          
          <!-- BRAND HEADER -->
          <div style="padding: 40px 30px; background-color: #1e293b;">
            <div style="background-color: #3b82f6; width: 64px; height: 64px; border-radius: 16px; margin: 0 auto 20px; line-height: 64px; font-size: 36px; font-weight: 900; color: #ffffff;">S</div>
            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: -1px;">Sahaara</h1>
            <div style="height: 4px; width: 40px; background-color: #22d3ee; margin: 15px auto 0; border-radius: 2px;"></div>
          </div>

          <!-- CONTENT BODY -->
          <div style="padding: 50px 40px; text-align: left;">
            <h2 style="color: #ffffff; font-size: 24px; font-weight: 700; margin-top: 0; margin-bottom: 20px;">Welcome to the family!</h2>
            <p style="color: rgba(255,255,255,0.7); line-height: 1.8; font-size: 16px; margin-bottom: 30px;">
              We're so excited to have you join Sahaara. To keep our community safe and ensure you're a real person, please confirm your email address by tapping the friendly blue button below.
            </p>
            
            <div style="text-align: center; margin: 40px 0;">
              <a href="${verifyUrl}" style="background-color: #3b82f6; color: #ffffff; padding: 18px 36px; text-decoration: none; border-radius: 12px; font-weight: 800; font-size: 16px; display: inline-block; letter-spacing: 1px;">VERIFY MY EMAIL</a>
            </div>

            <p style="color: rgba(255,255,255,0.5); font-size: 14px; margin-top: 40px; line-height: 1.5;">
              If the link doesn't work, just copy and paste this into your browser:
              <br>
              <a href="${verifyUrl}" style="color: #22d3ee; text-decoration: none; word-break: break-all;">${verifyUrl}</a>
            </p>
          </div>

          <!-- FOOTER -->
          <div style="padding: 30px; background-color: rgba(255,255,255,0.03); text-align: center; border-top: 1px solid rgba(255,255,255,0.05);">
            <p style="margin: 0; font-size: 12px; color: rgba(255,255,255,0.4); font-style: italic;">
              This secure link will expire in 60 minutes.
            </p>
            <p style="margin: 10px 0 0; font-size: 11px; color: rgba(255,255,255,0.3);">
              Sahaara Community Platform &bull; Pakistan
            </p>
          </div>

        </div>
      </div>
    `,
    });

    if (error) {
      console.error("Resend verification error:", error);
      throw error;
    }

    console.log("Verification email sent via Resend:", data?.id);
    return data;
  } catch (error) {
    console.error("Error sending verification email:", error);
    throw error;
  }
};

export const sendPasswordResetEmail = async (email: string, code: string) => {
  try {
    const { data, error } = await resend.emails.send({
      from: `Sahaara Support <${DEFAULT_FROM}>`,
      to: email,
      subject: "Reset your Sahaara password",
      html: `
      <div style="background-color: #020617; padding: 40px 20px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; text-align: center;">
        <div style="max-width: 600px; margin: auto; background-color: #0F172A; border-radius: 24px; overflow: hidden; border: 1px solid rgba(255,255,255,0.1);">
          
          <!-- BRAND HEADER -->
          <div style="padding: 40px 30px; background-color: #1e293b;">
            <div style="background-color: #3b82f6; width: 64px; height: 64px; border-radius: 16px; margin: 0 auto 20px; line-height: 64px; font-size: 36px; font-weight: 900; color: #ffffff;">S</div>
            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: -1px;">Sahaara</h1>
            <div style="height: 4px; width: 40px; background-color: #22d3ee; margin: 15px auto 0; border-radius: 2px;"></div>
          </div>

          <!-- CONTENT BODY -->
          <div style="padding: 50px 40px; text-align: left;">
            <h2 style="color: #ffffff; font-size: 24px; font-weight: 700; margin-top: 0; margin-bottom: 20px;">Forgot your password?</h2>
            <p style="color: rgba(255,255,255,0.7); line-height: 1.8; font-size: 16px; margin-bottom: 30px;">
              Don't worry, it happens to the best of us. Use the security code below to reset your password and get back to the community.
            </p>
            
            <div style="text-align: center; margin: 40px 0;">
              <div style="background-color: rgba(59, 130, 246, 0.1); border: 2px dashed #3b82f6; color: #ffffff; padding: 20px; border-radius: 16px; display: inline-block;">
                <span style="font-size: 42px; font-weight: 900; letter-spacing: 12px; font-family: monospace; color: #22d3ee;">${code}</span>
              </div>
            </div>

            <p style="color: rgba(255,255,255,0.5); font-size: 14px; margin-top: 40px; line-height: 1.5; text-align: center;">
              This code will expire in 15 minutes. If you didn't request this, you can safely ignore this email.
            </p>
          </div>

          <!-- FOOTER -->
          <div style="padding: 30px; background-color: rgba(255,255,255,0.03); text-align: center; border-top: 1px solid rgba(255,255,255,0.05);">
            <p style="margin: 0; font-size: 11px; color: rgba(255,255,255,0.3);">
              Sahaara Community Platform &bull; Pakistan
            </p>
          </div>

        </div>
      </div>
    `,
    });

    if (error) {
      console.error("Resend reset error:", error);
      throw error;
    }

    console.log("Password reset email sent via Resend:", data?.id);
    return data;
  } catch (error) {
    console.error("Error sending password reset email:", error);
    throw error;
  }
};
