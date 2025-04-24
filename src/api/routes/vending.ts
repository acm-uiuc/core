import { withTags } from "api/components/index.js";
import { FastifyPluginAsync } from "fastify";
import { FastifyZodOpenApiTypeProvider } from "fastify-zod-openapi";
import { z } from "zod";

const postSchema = z.object({
  name: z.string().min(1),
  imageUrl: z.string().url(),
  price: z.number().min(0),
});

const vendingPlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.get(
    "/items",
    {
      schema: withTags(["Vending"], {}),
    },
    async (request, reply) => {
      reply.send({
        items: [
          {
            slots: ["A1"],
            id: "ronitpic",
            name: "A Picture of Ronit",
            image_url: "https://static.acm.illinois.edu/ronit.jpeg",
            price: 999,
            calories: null,
            fat: null,
            carbs: null,
            fiber: null,
            sugar: null,
            protein: null,
            quantity: 100,
            locations: null,
          },
        ],
      });
    },
  );
  fastify.withTypeProvider<FastifyZodOpenApiTypeProvider>().post(
    "/items",
    {
      schema: withTags(["Vending"], {
        body: postSchema,
      }),
    },
    async (request, reply) => {
      reply.send({ status: "Not implemented." });
    },
  );
};

export default vendingPlugin;
