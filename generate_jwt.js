import jwt from 'jsonwebtoken';
import * as dotenv from "dotenv";
dotenv.config();

const username = process.env.JWTGEN_USERNAME || 'infra@acm.illinois.edu'
const payload = {
    aud: "custom_jwt",
    iss: "custom_jwt",
    iat: Math.floor(Date.now() / 1000),
    nbf: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (3600 * 24), // Token expires after 24 hour
    acr: "1",
    aio: "AXQAi/8TAAAA",
    amr: ["pwd"],
    appid: "your-app-id",
    appidacr: "1",
    email: username,
    groups: ["0"],
    idp: "https://login.microsoftonline.com",
    ipaddr: "192.168.1.1",
    name: "Singh, Dev",
    oid: "00000000-0000-0000-0000-000000000000",
    rh: "rh-value",
    scp: "user_impersonation",
    sub: "subject",
    tid: "tenant-id",
    unique_name: username,
    uti: "uti-value",
    ver: "1.0"
};

const secretKey = process.env.JwtSigningKey;
const token = jwt.sign(payload, secretKey, { algorithm: 'HS256' });
console.log(`USERNAME=${username}`)
console.log('=====================')
console.log(token)
