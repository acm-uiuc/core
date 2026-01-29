import { SendRawEmailCommand } from "@aws-sdk/client-ses";
import { encode } from "base64-arraybuffer";
import { AvailableSQSFunctions, SQSPayload } from "common/types/sqsMessage.js";

/**
 * Generates a SendRawEmailCommand for SES to send an email with an attached membership pass.
 *
 * @param recipientEmail - The email address of the recipient.
 * * @param recipientEmail - The email address of the sender with a verified identity in SES.
 * @param attachmentBuffer - The membership pass in ArrayBufferLike format.
 * @returns The command to send the email via SES.
 */
export function generateMembershipEmailCommand(
  recipientEmail: string,
  senderEmail: string,
  attachmentBuffer: ArrayBufferLike,
  firstName?: string,
): SendRawEmailCommand {
  const encodedAttachment = encode(attachmentBuffer as ArrayBuffer);
  const boundary = "----BoundaryForEmail";

  const emailTemplate = `
<!doctype html>
<html>
    <head>
        <title>Your ACM @ UIUC Membership</title>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1">
        <base target="_blank">
        <style>
            body {
                background-color: #F0F1F3;
                font-family: 'Helvetica Neue', 'Segoe UI', Helvetica, sans-serif;
                font-size: 15px;
                line-height: 26px;
                margin: 0;
                color: #444;
            }
            .wrap {
                background-color: #fff;
                padding: 30px;
                max-width: 525px;
                margin: 0 auto;
                border-radius: 5px;
            }
            .button {
                background: #0055d4;
                border-radius: 3px;
                text-decoration: none !important;
                color: #fff !important;
                font-weight: bold;
                padding: 10px 30px;
                display: inline-block;
            }
            .button:hover {
                background: #111;
            }
            .footer {
                text-align: center;
                font-size: 12px;
                color: #888;
            }
            img {
                max-width: 100%;
                height: auto;
            }
            a {
                color: #0055d4;
            }
            a:hover {
                color: #111;
            }
            @media screen and (max-width: 600px) {
                .wrap {
                    max-width: auto;
                }
            }
        </style>
    </head>
<body>
    <div class="gutter" style="padding: 30px;">&nbsp;</div>
    <img src="https://static.acm.illinois.edu/banner-blue.png" style="height: 100px; width: 210px; align-self: center;"/>
    <br />
    <div class="wrap">
        <h2 style="text-align: center;">Welcome${firstName ? `, ${firstName}` : ""}!</h2>
        <p>
            Thank you for becoming a member of ACM @ UIUC! Attached is your membership pass.
            You can add it to your Apple or Google Wallet for easy access.
        </p>
        <p>
            If you have any questions, feel free to contact us at
            <a href="mailto:officers@acm.illinois.edu">officers@acm.illinois.edu</a>.
        </p>
        <p>
            We also encourage you to check out our resources page, where you can find the benefits associated with your membership.
            Welcome to ACM @ UIUC!
        </p>
        <div style="text-align: center; margin-top: 20px;">
            <a href="https://www.acm.illinois.edu/resources" class="button">ACM @ UIUC Resources</a>
        </div>
    </div>
    <div class="footer">
        <p>
            <a href="https://acm.illinois.edu">ACM @ UIUC Homepage</a>
            <a href="mailto:officers@acm.illinois.edu">Email ACM @ UIUC</a>
        </p>
    </div>
</body>
</html>
  `;

  const rawEmail = `
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="${boundary}"
From: ACM @ UIUC <${senderEmail}>
To: ${recipientEmail}
Subject: Your ACM @ UIUC Membership

--${boundary}
Content-Type: text/html; charset="UTF-8"

${emailTemplate}

--${boundary}
Content-Type: application/vnd.apple.pkpass
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="membership.pkpass"

${encodedAttachment}
--${boundary}--`.trim();
  return new SendRawEmailCommand({
    RawMessage: {
      Data: new TextEncoder().encode(rawEmail),
    },
  });
}

/**
 * Generates a SendRawEmailCommand for SES to send a sales confirmation email
 *
 * @param payload - The SQS Payload for sending sale emails
 * @param senderEmail - The email address of the sender with a verified identity in SES.
 * @param imageBuffer - The normal image ticket/pass in ArrayBufferLike format.
 * @returns The command to send the email via SES.
 */
export function generateSalesEmail(
  payload: SQSPayload<AvailableSQSFunctions.SendSaleEmail>["payload"],
  senderEmail: string,
  imageBuffer?: ArrayBufferLike,
): SendRawEmailCommand {
  const boundary = "----BoundaryForEmail";
  const subject = `Your purchase has been confirmed!`;

  // Format items list
  const itemsList = payload.itemsPurchased
    .map((item) => {
      const variant = item.variantName ? ` (${item.variantName})` : "";
      return `${item.quantity}x ${item.itemName}${variant}`;
    })
    .join(", ");

  const verificationInstructions = payload.isVerifiedIdentity
    ? "Show your Illinois iCard or Illinois App QR code to our staff to verify your purchase at pickup."
    : "Show the attached QR code to our staff to verify your purchase at pickup.";

  const emailTemplate = `
<!doctype html>
<html>
<head>
    <title>${subject}</title>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1">
    <base target="_blank">
    <style>
        body {
            background-color: #F0F1F3;
            font-family: 'Helvetica Neue', 'Segoe UI', Helvetica, sans-serif;
            font-size: 15px;
            line-height: 26px;
            margin: 0;
            color: #444;
        }
        .wrap {
            background-color: #fff;
            padding: 30px;
            max-width: 525px;
            margin: 0 auto;
            border-radius: 5px;
        }
        .button {
            background: #0055d4;
            border-radius: 3px;
            text-decoration: none !important;
            color: #fff !important;
            font-weight: bold;
            padding: 10px 30px;
            display: inline-block;
        }
        .button:hover {
            background: #111;
        }
        .footer {
            text-align: center;
            font-size: 12px;
            color: #888;
        }
        img {
            max-width: 100%;
            height: auto;
        }
        a {
            color: #0055d4;
        }
        a:hover {
            color: #111;
        }
        @media screen and (max-width: 600px) {
            .wrap {
                max-width: auto;
            }
        }
    </style>
</head>
<body>
    <div class="gutter" style="padding: 30px;">&nbsp;</div>
    <img src="https://static.acm.illinois.edu/banner-blue.png" style="height: 100px; width: 210px; align-self: center;"/>
    <br />
    <div class="wrap">
        <h2 style="text-align: center;">${subject}</h2>
        <p>
            Thank you for your purchase of ${itemsList}.
            ${verificationInstructions}
        </p>
        ${payload.customText ? `<p>${payload.customText}</p>` : ""}
        <p>
            If you have any questions, feel free to ask on our Discord!
        </p>
        <div style="text-align: center; margin-top: 20px;">
            <a href="https://acm.gg/discord" class="button">Join our Discord</a>
        </div>
    </div>
    <div class="footer">
        <p>
            <a href="https://www.acm.illinois.edu?utm_source=store_email">ACM @ UIUC Homepage</a>
            <a href="mailto:admin@acm.illinois.edu">Email ACM @ UIUC</a>
        </p>
    </div>
</body>
</html>
  `;

  // Build email based on whether we need to attach a QR code
  let rawEmail: string;

  if (payload.isVerifiedIdentity) {
    // Simple email without attachment
    rawEmail = `
MIME-Version: 1.0
Content-Type: text/html; charset="UTF-8"
From: ACM @ UIUC Store <${senderEmail}>
To: ${payload.email}
Subject: Your ACM @ UIUC Purchase

${emailTemplate}`.trim();
  } else {
    // Email with QR code attachment
    if (!imageBuffer) {
      throw new Error(
        "imageBuffer is required when isVerifiedIdentity is false",
      );
    }
    const encodedImage = encode(imageBuffer as ArrayBuffer);

    rawEmail = `
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="${boundary}"
From: ACM @ UIUC Store <${senderEmail}>
To: ${payload.email}
Subject: Your ACM @ UIUC Purchase

--${boundary}
Content-Type: text/html; charset="UTF-8"

${emailTemplate}

--${boundary}
Content-Type: image/png
Content-Transfer-Encoding: base64
Content-Disposition: attachment; filename="purchase-qr.png"

${encodedImage}
--${boundary}--`.trim();
  }

  return new SendRawEmailCommand({
    RawMessage: {
      Data: new TextEncoder().encode(rawEmail),
    },
  });
}
