export type EventSubscriber<TEvent> = (event: TEvent) => void

export type EventBroker<TEvent> = {
  publish: (threadId: string, event: TEvent) => void
  subscribe: (
    threadId: string,
    subscriber: EventSubscriber<TEvent>
  ) => () => void
}

export const createEventBroker = <TEvent>(): EventBroker<TEvent> => {
  const subscribers = new Map<string, Set<EventSubscriber<TEvent>>>()

  const publish = (threadId: string, event: TEvent) => {
    const set = subscribers.get(threadId)

    if (!set) return

    for (const subscriber of set) {
      try {
        subscriber(event)
      } catch (error) {
        console.error('event-broker subscriber threw', error)
      }
    }
  }

  const subscribe = (threadId: string, subscriber: EventSubscriber<TEvent>) => {
    let set = subscribers.get(threadId)

    if (!set) {
      set = new Set()
      subscribers.set(threadId, set)
    }

    set.add(subscriber)

    return () => {
      const current = subscribers.get(threadId)

      if (!current) return

      current.delete(subscriber)

      if (current.size === 0) {
        subscribers.delete(threadId)
      }
    }
  }

  return { publish, subscribe }
}
