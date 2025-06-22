const template = /*html*/ `
<!doctype html>
<html>
    <head>
        <title>{{subject}}</title>
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
        {{nl2br content}}
    </div>
    <div class="footer">
        <p>
            <a href="https://acm.illinois.edu">ACM @ UIUC Homepage</a>
            <a href="mailto:admin@acm.illinois.edu">Email ACM @ UIUC</a>
        </p>
    </div>
</body>
</html>
`;
export default template;
