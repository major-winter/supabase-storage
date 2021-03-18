import { FastifyInstance } from 'fastify'
import { getPostgrestClient, getOwner, transformPostgrestError, isValidKey } from '../../utils'
import { AuthenticatedRequest, Bucket } from '../../types/types'
import { FromSchema } from 'json-schema-to-ts'
import { bucketSchema } from '../../schemas/bucket'

const createBucketBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    id: { type: 'string' },
  },
  required: ['name'],
} as const

const successResponseSchema = bucketSchema
interface createBucketRequestInterface extends AuthenticatedRequest {
  Body: FromSchema<typeof createBucketBodySchema>
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export default async function routes(fastify: FastifyInstance) {
  const summary = 'Create a bucket'
  fastify.post<createBucketRequestInterface>(
    '/',
    {
      schema: {
        body: createBucketBodySchema,
        headers: { $ref: 'authSchema#' },
        summary,
        response: { 200: successResponseSchema, '4xx': { $ref: 'errorSchema#' } },
      },
    },
    async (request, response) => {
      const authHeader = request.headers.authorization
      const jwt = authHeader.substring('Bearer '.length)
      const postgrest = getPostgrestClient(jwt)
      const owner = await getOwner(jwt)

      const { name: bucketName } = request.body
      let id = request.body.id
      if (!id) {
        //by default set the id as the name of the bucket
        id = bucketName
      }

      if (!isValidKey(id) || !isValidKey(bucketName)) {
        return response.status(400).send({
          statusCode: '400',
          error: 'Invalid key',
          message: 'The key contains invalid characters',
        })
      }

      const { data: results, error, status } = await postgrest
        .from<Bucket>('buckets')
        .insert([
          {
            id,
            name: bucketName,
            owner,
          },
        ])
        .single()
      console.log(results, error)

      if (error) {
        return response.status(400).send(transformPostgrestError(error, status))
      }
      return response.status(200).send(results)
    }
  )
}
