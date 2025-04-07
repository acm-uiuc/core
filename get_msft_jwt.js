import request from "request";

const client_secret = process.env.AadClientSecret;
if (!client_secret) {
  console.error("Did not find client secret in environment.");
  process.exit(1);
}

var options = {
  method: "POST",
  url: "https://login.microsoftonline.com/c8d9148f-9a59-4db3-827d-42ea0c2b6e2e/oauth2/token",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie:
      "esctx=PAQABBwEAAAApTwJmzXqdR4BN2miheQMYx8m4odNFiSkFXBDxAsyDVihl0yV2geMRVf-xYZ_GI34ZgJzPlzsLI4IyGrHFUcRyt_kOrGgfKtxKD_l8Shb9DAyh2xT4JeGXJhIyqsMO-lMmpvDuGjePONePVhmPE4TzQuQUh6V8Y4yWwBV10HljcSWz0Jp0DGs5MB4wMCl3CVwgAA; fpc=Asmn40XcT3RJkq8G_zKhA64gJa0wAQAAANHbRN4OAAAADPYZNQMAAADZ20TeDgAAABa8tnsBAAAAeN1E3g4AAAA; stsservicecookie=estsfd; x-ms-gateway-slice=estsfd",
  },
  form: {
    grant_type: "client_credentials",
    client_id: "519866d4-45a8-44ae-9925-9fb61b85074e",
    client_secret: client_secret,
    resource: "api://5e08cf0f-53bb-4e09-9df2-e9bdc3467296",
    scope: "api://5e08cf0f-53bb-4e09-9df2-e9bdc3467296/ACM.Events.Login",
  },
};
request(options, function (error, response) {
  if (error) throw new Error(error);
  console.log(JSON.parse(response.body)["access_token"]);
});
