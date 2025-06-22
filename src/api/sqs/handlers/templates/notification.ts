const template = /*html*/ `
<!doctype html>
<html>

<head>
  <title>{{ subject }}</title>
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
  </style>
</head>

<body
  style="background-color: #F0F1F3;font-family: 'Helvetica Neue', 'Segoe UI', Helvetica, sans-serif;font-size: 15px;line-height: 26px;margin: 0;color: #444;">
  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #F0F1F3;">
    <tr>
      <td align="center" style="padding: 30px;">
        <table width="525" border="0" cellpadding="0" cellspacing="0"
          style="width: 525px; max-width: 525px; background-color: #ffffff; border-radius: 5px;">
          <tr>
            <td align="center" style="padding-top: 30px;"> <img src="https://static.acm.illinois.edu/banner-blue.png"
                style="height: 100px; width: 210px; display: block; margin: 0 auto;" alt="ACM UIUC Logo" /> </td>
          </tr>
          <tr>
            <td style="padding: 30px;"> {{nl2br content}} </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom: 30px;">
              <p style="font-size: 12px; color: #888; text-align: center;"> <a href="https://acm.illinois.edu"
                  style="color: #888;">ACM @ UIUC Homepage</a> <a href="mailto:officers@acm.illinois.edu"
                  style="color: #888; margin-left: 5px;">Email ACM @ UIUC</a> </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding: 15px 30px;">
        <table width="525" border="0" cellpadding="0" cellspacing="0" style="width: 525px; max-width: 525px;">
          <tr>
            <td style="padding: 0;">
              <hr style="border: none; border-top: 1px solid #ccc;">
              <p style="font-size: 12px; color: #888; margin-top: 15px;"> You cannot unsubscribe from transactional
                emails. To ensure delivery, add {{from}} to your address book. </p>
              <p style="font-size: 12px; color: #888; margin-top: 15px;"> Please do not respond to this message, as
                emails to this address are not monitored. </p>
              <p style="font-size: 12px; color: #888; margin-top: 15px;"> &copy; {{currentYear}} ACM @ UIUC.
                All trademarks are the property of their respective owners. </p>
              <p style="font-size: 12px; color: #888; margin-top: 45px;"> {{id}} </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
export default template;
