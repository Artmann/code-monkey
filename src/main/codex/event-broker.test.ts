import { describe, expect, test, vi } from 'vitest'

import { createEventBroker } from './event-broker'

type Event = { type: string; payload?: unknown }

describe('event-broker', () => {
  test('delivers published events to matching subscribers', () => {
    const broker = createEventBroker<Event>()
    const received: Event[] = []

    broker.subscribe('thread-a', (event) => received.push(event))
    broker.publish('thread-a', { type: 'item.completed' })

    expect(received).toEqual([{ type: 'item.completed' }])
  })

  test('isolates subscribers by thread id', () => {
    const broker = createEventBroker<Event>()
    const receivedA: Event[] = []
    const receivedB: Event[] = []

    broker.subscribe('thread-a', (event) => receivedA.push(event))
    broker.subscribe('thread-b', (event) => receivedB.push(event))

    broker.publish('thread-a', { type: 'a-event' })
    broker.publish('thread-b', { type: 'b-event' })

    expect(receivedA).toEqual([{ type: 'a-event' }])
    expect(receivedB).toEqual([{ type: 'b-event' }])
  })

  test('delivers to multiple subscribers on the same thread', () => {
    const broker = createEventBroker<Event>()
    const receivedOne: Event[] = []
    const receivedTwo: Event[] = []

    broker.subscribe('thread-a', (event) => receivedOne.push(event))
    broker.subscribe('thread-a', (event) => receivedTwo.push(event))

    broker.publish('thread-a', { type: 'hello' })

    expect(receivedOne).toEqual([{ type: 'hello' }])
    expect(receivedTwo).toEqual([{ type: 'hello' }])
  })

  test('unsubscribe stops further delivery to that subscriber', () => {
    const broker = createEventBroker<Event>()
    const received: Event[] = []

    const unsubscribe = broker.subscribe('thread-a', (event) =>
      received.push(event)
    )

    broker.publish('thread-a', { type: 'first' })
    unsubscribe()
    broker.publish('thread-a', { type: 'second' })

    expect(received).toEqual([{ type: 'first' }])
  })

  test('publishing to a thread with no subscribers is a no-op', () => {
    const broker = createEventBroker<Event>()

    expect(() => broker.publish('nobody-home', { type: 'x' })).not.toThrow()
  })

  test('a subscriber throwing does not prevent others from receiving', () => {
    const broker = createEventBroker<Event>()
    const received: Event[] = []
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    broker.subscribe('thread-a', () => {
      throw new Error('boom')
    })
    broker.subscribe('thread-a', (event) => received.push(event))

    expect(() =>
      broker.publish('thread-a', { type: 'still-delivered' })
    ).not.toThrow()
    expect(received).toEqual([{ type: 'still-delivered' }])
    expect(consoleError).toHaveBeenCalledWith(
      'event-broker subscriber threw',
      expect.any(Error)
    )

    consoleError.mockRestore()
  })
})
