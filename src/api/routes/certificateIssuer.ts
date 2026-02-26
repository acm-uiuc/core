import { FastifyPluginAsync } from "fastify";
import { withRoles, withTags } from "api/components/index.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { assertAuthenticated } from "api/authenticated.js";
import { signSshCertificateWithKMS } from "api/functions/certificateIssuer.js";
import { getNetIdFromEmail } from "common/utils.js";
import { genericConfig } from "common/config.js";

const certificateIssuerRoutes: FastifyPluginAsync = async (
  fastify,
  _options,
) => {
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/ssh",
    {
      schema: withRoles(
        [],
        withTags(["Certificate Issuer"], {
          body: z.object({
            sshPublicKey: z
              .string()
              .min(1)
              .meta({ description: "The user's SSH public key to sign." }),
          }),
          response: {
            201: {
              description: "The signature was generated",
              content: {
                "text/plain": {
                  schema: z.string(),
                },
              },
            },
          },
          summary: "Issue an ephemeral SSH certificate.",
        }),
      ),
      onRequest: fastify.authorizeFromSchema,
    },
    assertAuthenticated(async (request, reply) => {
      const netId = getNetIdFromEmail(request.username);
      const principals = [netId, request.username];
      const identityRaw = {
        sub: request.username,
        email: request.username,
        login: netId, // e.g. "alice" from "alice@company.com"
        groups: request.tokenPayload?.groups || [],
        iat: Math.floor(Date.now() / 1000),
      };
      const identity = Buffer.from(JSON.stringify(identityRaw)).toString(
        "base64",
      );
      const signature = await signSshCertificateWithKMS({
        principals,
        identity,
        kmsKeyId: genericConfig.CertificateKmsKey,
        userPubKeyString: request.body.sshPublicKey,
        validForSeconds: 3600,
        logger: request.log,
      });
      const resp = `rsa-sha2-256-cert-v01@openssh.com ${signature.toString("base64")} ${request.username}`;
      return reply.status(201).send(resp);
    }),
  );
};

export default certificateIssuerRoutes;
