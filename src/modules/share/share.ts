import express, { Request, Response } from "express";

export const shareRouter = express.Router();

/**
 * @api {get} /share/:type/:id Share Redirector
 * @apiName ShareRedirect
 * @apiGroup Share
 *
 * @apiParam {String} type Entity type (request, offer, alert)
 * @apiParam {String} id Entity ID
 */
shareRouter.get("/:type/:id", (req: Request, res: Response) => {
  const { type, id } = req.params;

  const appScheme = "sahaaramobile://";
  const path = type === "request" ? "requestDetails" : type + "Details";
  const deepLink = `${appScheme}${path}?id=${id}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Opening Sahaara...</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: #020617;
            color: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            text-align: center;
            padding: 20px;
        }
        .container {
            max-width: 400px;
        }
        .logo {
            font-size: 48px;
            font-weight: bold;
            margin-bottom: 20px;
            background: linear-gradient(to right, #6366F1, #22D3EE);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .message {
            font-size: 18px;
            margin-bottom: 30px;
            color: rgba(255, 255, 255, 0.7);
        }
        .btn {
            background-color: #6366F1;
            color: white;
            text-decoration: none;
            padding: 15px 30px;
            border-radius: 12px;
            font-weight: bold;
            font-size: 16px;
            display: inline-block;
            transition: opacity 0.2s;
        }
        .btn:hover {
            opacity: 0.9;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo">Sahaara</div>
        <div class="message">Click the button below to view the full details in the app.</div>
        <a href="${deepLink}" class="btn">Open in Sahaara App</a>
    </div>

    <script>
        // Try to auto-open
        window.location.href = "${deepLink}";
        
        // Secondary attempt for some browsers
        setTimeout(function() {
            window.location.replace("${deepLink}");
        }, 500);
    </script>
</body>
</html>
  `;

  res.send(html);
});
