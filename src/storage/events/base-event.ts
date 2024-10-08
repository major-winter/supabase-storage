import { Event as QueueBaseEvent, BasePayload, StaticThis, Event } from '@internal/queue'
import { getPostgresConnection, getServiceKeyUser } from '@internal/database'
import { StorageKnexDB } from '../database'
import { createAgent, createStorageBackend } from '../backend'
import { Storage } from '../storage'
import { getConfig } from '../../config'
import { logger } from '@internal/monitoring'
import Agent, { HttpsAgent } from 'agentkeepalive'

const { storageBackendType, region } = getConfig()

let httpAgent: { httpAgent: Agent; httpsAgent: HttpsAgent } | undefined

export abstract class BaseEvent<T extends Omit<BasePayload, '$version'>> extends QueueBaseEvent<T> {
  /**
   * Sends a message as a webhook
   * @param payload
   */
  static async sendWebhook<T extends Event<any>>(
    this: StaticThis<T>,
    payload: Omit<T['payload'], '$version'>
  ) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Webhook } = require('./webhook')
    const eventType = this.eventName()

    try {
      await Webhook.send({
        event: {
          type: eventType,
          region,
          $version: this.version,
          applyTime: Date.now(),
          payload,
        },
        tenant: payload.tenant,
      })
    } catch (e) {
      logger.error(
        {
          error: e,
          event: {
            type: eventType,
            $version: this.version,
            applyTime: Date.now(),
            payload: JSON.stringify(payload),
          },
          tenant: payload.tenant,
        },
        `error sending webhook: ${eventType}`
      )
    }
  }

  protected static getAgent() {
    if (httpAgent) {
      return httpAgent
    }
    httpAgent = createAgent('s3_worker')
    return httpAgent
  }

  protected static async createStorage(payload: BasePayload) {
    const adminUser = await getServiceKeyUser(payload.tenant.ref)

    const client = await getPostgresConnection({
      user: adminUser,
      superUser: adminUser,
      host: payload.tenant.host,
      tenantId: payload.tenant.ref,
      disableHostCheck: true,
    })

    const db = new StorageKnexDB(client, {
      tenantId: payload.tenant.ref,
      host: payload.tenant.host,
    })

    const storageBackend = createStorageBackend(storageBackendType, {
      httpAgent: BaseEvent.getAgent(),
    })

    return new Storage(storageBackend, db)
  }
}
