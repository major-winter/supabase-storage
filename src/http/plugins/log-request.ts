import fastifyPlugin from 'fastify-plugin'
import { logSchema, redactQueryParamFromRequest } from '@internal/monitoring'
import { trace } from '@opentelemetry/api'

interface RequestLoggerOptions {
  excludeUrls?: string[]
}

declare module 'fastify' {
  interface FastifyRequest {
    executionError?: Error
    operation?: { type: string }
    resources?: string[]
    startTime: number
  }

  interface FastifyContextConfig {
    operation?: { type: string }
    resources?: (req: FastifyRequest<any>) => string[]
  }
}

export const logRequest = (options: RequestLoggerOptions) =>
  fastifyPlugin(
    async (fastify) => {
      fastify.addHook('onRequest', async (req) => {
        req.startTime = Date.now()
      })

      fastify.addHook('preHandler', async (req) => {
        const resourceFromParams = Object.values(req.params || {}).join('/')
        const resources = getFirstDefined<string[]>(
          req.resources,
          req.routeConfig.resources?.(req),
          (req.raw as any).resources,
          resourceFromParams ? [resourceFromParams] : ([] as string[])
        )

        if (resources && resources.length > 0) {
          resources.map((resource, index) => {
            if (!resource.startsWith('/')) {
              resources[index] = `/${resource}`
            }
          })
        }

        req.resources = resources
        req.operation = req.routeConfig.operation

        if (req.operation) {
          trace.getActiveSpan()?.setAttribute('http.operation', req.operation.type)
        }
      })

      fastify.addHook('onRequestAbort', async (req) => {
        if (options.excludeUrls?.includes(req.url)) {
          return
        }

        const rMeth = req.method
        const rUrl = redactQueryParamFromRequest(req, [
          'token',
          'X-Amz-Credential',
          'X-Amz-Signature',
          'X-Amz-Security-Token',
        ])
        const uAgent = req.headers['user-agent']
        const rId = req.id
        const cIP = req.ip
        const error = (req.raw as any).executionError || req.executionError
        const tenantId = req.tenantId

        const buildLogMessage = `${tenantId} | ${rMeth} | ABORTED | ${cIP} | ${rId} | ${rUrl} | ${uAgent}`

        logSchema.request(req.log, buildLogMessage, {
          type: 'request',
          req,
          responseTime: (Date.now() - req.startTime) / 1000,
          error: error,
          owner: req.owner,
          operation: req.operation?.type ?? req.routeConfig.operation?.type,
          resources: req.resources,
          serverTimes: req.serverTimings,
        })
      })

      fastify.addHook('onResponse', async (req, reply) => {
        if (options.excludeUrls?.includes(req.url)) {
          return
        }

        const rMeth = req.method
        const rUrl = redactQueryParamFromRequest(req, [
          'token',
          'X-Amz-Credential',
          'X-Amz-Signature',
          'X-Amz-Security-Token',
        ])
        const uAgent = req.headers['user-agent']
        const rId = req.id
        const cIP = req.ip
        const statusCode = reply.statusCode
        const error = (req.raw as any).executionError || req.executionError
        const tenantId = req.tenantId

        const buildLogMessage = `${tenantId} | ${rMeth} | ${statusCode} | ${cIP} | ${rId} | ${rUrl} | ${uAgent}`

        logSchema.request(req.log, buildLogMessage, {
          type: 'request',
          req,
          res: reply,
          responseTime: reply.getResponseTime(),
          error: error,
          owner: req.owner,
          role: req.jwtPayload?.role,
          resources: req.resources,
          operation: req.operation?.type ?? req.routeConfig.operation?.type,
          serverTimes: req.serverTimings,
        })
      })
    },
    { name: 'log-request' }
  )

function getFirstDefined<T>(...values: any[]): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value
    }
  }
  return undefined
}
