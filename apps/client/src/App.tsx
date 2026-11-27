import {
  createVisualizerController,
  StateMachineVisualizer,
  type VisualizerController,
} from "@state-machine/visualizer";
import { useEffect, useRef, useState } from "react";
import { createActor, fromCallback, setup, type AnyActor } from "xstate";

declare global {
  interface Window {
    __visualizer?: VisualizerController;
  }
}

/**
 * Real programmatic XState v5 machine demonstrating live `controller.setMachine(machine)`
 * and `controller.attachActor(actor)` integration from application code.
 */
const liveSocketMachine = setup({
  guards: {
    canReconnect: ({ context }) => context.retries < 3,
  },
  actions: {
    logConnect: () => {},
    logDisconnect: () => {},
  },
  actors: {
    socketConnection: fromCallback(() => () => {}),
  },
}).createMachine({
  id: "websocketClient",
  initial: "disconnected",
  context: {
    retries: 0,
    endpoint: "wss://api.example.com/realtime",
  },
  states: {
    disconnected: {
      description: "Idle socket waiting for connect call.",
      on: {
        CONNECT: {
          target: "connecting",
          actions: "logConnect",
        },
      },
    },
    connecting: {
      description: "Opening WebSocket handshake.",
      invoke: {
        id: "handshake",
        src: "socketConnection",
        onDone: "connected",
        onError: [
          { target: "reconnecting", guard: "canReconnect" },
          { target: "failed" },
        ],
      },
      on: {
        OPENED: "connected",
        DISCONNECT: "disconnected",
      },
    },
    connected: {
      description: "Live bidirectional connection.",
      tags: ["online"],
      on: {
        DROP: "reconnecting",
        DISCONNECT: {
          target: "disconnected",
          actions: "logDisconnect",
        },
      },
    },
    reconnecting: {
      description: "Backoff before re-attempting handshake.",
      after: {
        2500: "connecting",
      },
      on: {
        RETRY_NOW: "connecting",
        DISCONNECT: "disconnected",
      },
    },
    failed: {
      type: "final",
      description: "Exhausted retry budget.",
    },
  },
});

export function App() {
  const [controller] = useState(() =>
    createVisualizerController({
      config: {
        theme: "dark",
        mode: "design",
        layoutDirection: "RIGHT",
        enableBrowserStorage: true,
        enableFileIO: true,
      },
      seedPresetsIfEmpty: true,
    }),
  );

  const liveActorRef = useRef<AnyActor | null>(null);
  const [liveAttached, setLiveAttached] = useState(false);
  const [compactReadOnly, setCompactReadOnly] = useState(false);

  useEffect(() => {
    window.__visualizer = controller;
    return () => {
      liveActorRef.current?.stop();
      controller.destroy();
      delete window.__visualizer;
    };
  }, [controller]);

  function handleLoadProgrammaticMachine() {
    if (liveActorRef.current) {
      liveActorRef.current.stop();
      liveActorRef.current = null;
      controller.detachActor();
      setLiveAttached(false);
    }
    controller.setMachine(liveSocketMachine, { markDirty: false });
    controller.setMode("design");
  }

  function handleToggleLiveActor() {
    if (liveAttached && liveActorRef.current) {
      liveActorRef.current.stop();
      liveActorRef.current = null;
      controller.detachActor();
      controller.setMode("design");
      setLiveAttached(false);
      return;
    }

    controller.setMachine(liveSocketMachine, { markDirty: false });
    const actor = createActor(liveSocketMachine);
    actor.start();
    liveActorRef.current = actor;
    controller.attachActor(actor);
    setLiveAttached(true);
  }

  function handleToggleCompactReadOnly() {
    const next = !compactReadOnly;
    setCompactReadOnly(next);
    controller.setConfig({
      readOnly: next,
      showLeftPanel: !next,
      showRightPanel: !next,
    });
  }

  return (
    <div className="client-shell">
      <div className="client-banner">
        <div className="client-brand">
          <span>@state-machine/visualizer</span>
          <span className="client-badge">XState v5 · Programmatic</span>
        </div>

        <div className="client-actions">
          <button
            type="button"
            className="client-btn"
            onClick={handleLoadProgrammaticMachine}
          >
            Load Code Machine
          </button>
          <button
            type="button"
            className={`client-btn ${liveAttached ? "active" : ""}`}
            onClick={handleToggleLiveActor}
          >
            {liveAttached ? "Detach Live Actor" : "Attach Live Actor"}
          </button>
          {liveAttached && (
            <>
              <button
                type="button"
                className="client-btn"
                onClick={() => liveActorRef.current?.send({ type: "CONNECT" })}
              >
                actor.send(CONNECT)
              </button>
              <button
                type="button"
                className="client-btn"
                onClick={() => liveActorRef.current?.send({ type: "OPENED" })}
              >
                actor.send(OPENED)
              </button>
            </>
          )}
          <button
            type="button"
            className={`client-btn ${compactReadOnly ? "active" : ""}`}
            onClick={handleToggleCompactReadOnly}
          >
            {compactReadOnly ? "Exit Read-Only Embed" : "Read-Only Embed"}
          </button>
        </div>
      </div>

      <main className="client-main">
        <StateMachineVisualizer controller={controller} />
      </main>
    </div>
  );
}
