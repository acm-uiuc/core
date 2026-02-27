import { FastifyPluginAsync } from "fastify";
import { withRoles, withTags } from "api/components/index.js";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import * as z from "zod/v4";
import { assertAuthenticated } from "api/authenticated.js";
import { signSshCertificateWithKMS } from "api/functions/certificateIssuer.js";
import { getNetIdFromEmail } from "common/utils.js";
import { genericConfig } from "common/config.js";
import { ValidationError } from "common/errors/index.js";
import { SSH_CERTIFICATE_SIGNATURE_VALIDITY_SECONDS } from "common/constants.js";

const certificateIssuerRoutes: FastifyPluginAsync = async (
  fastify,
  _options,
) => {
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/ssh/signPublicKey",
    {
      schema: withRoles(
        [],
        withTags(["Certificate Issuer"], {
          body: z.object({
            sshPublicKey: z
              .string()
              .min(1)
              .meta({
                description: "The user's SSH RSA public key to sign.",
                examples: [
                  "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCWBJHvKqjIqvVR9igz8ofetDXYKKcVCCc20eO/2nIkSxVFhCiO9Ut73EOHqBCXJOWcklgPNDxYlu5a/Pj0Fl6it1d3QG2JT0hAqZ1A8iNN1Qq0ucCbbVHEEjPbibVt0wR46MbGlkY3HIjcUEjyO6Trca0fDUNhIwjUNhnFrb5D6Jg7RgNI0/iiEnqYqwJoMCA5SecETajsgcxJTBNrByg2AS1mfqDDALR9U6JwHCzfI0nhhoKFqPSIAQUkgsHcQUtni9eIKOzGCJguc02tDE9FI5XJdsBHNUUaK7PBmBdwUkxMTlpk0hMoyPCBgihu4m/lrAT7vvkrFyLXNH4k8rJR example",
                ],
              }),
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
      const { log: logger, username } = request;
      let netId: string;
      let principals: string[] = [];
      try {
        netId = getNetIdFromEmail(username);
        principals = [netId, username];
      } catch (e) {
        if (e instanceof ValidationError) {
          request.log.warn(
            { username },
            "Invalid username for NetID conversion, using full username for identity.",
          );
          netId = username;
          principals = [username];
        }
        throw e;
      }
      const identityRaw = {
        sub: username,
        email: username,
        login: netId,
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
        validForSeconds: SSH_CERTIFICATE_SIGNATURE_VALIDITY_SECONDS,
        logger,
      });
      const resp = `rsa-sha2-256-cert-v01@openssh.com ${signature.toString("base64")} ${username}`;
      return reply.status(201).send(resp);
    }),
  );
};

export default certificateIssuerRoutes;
