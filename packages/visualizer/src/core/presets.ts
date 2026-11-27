import type { MachineDocument } from "./types.ts";

export interface MachinePreset {
  id: string;
  label: string;
  summary: string;
  document: MachineDocument;
}

export const AUTH_FLOW_PRESET: MachineDocument = {
  version: 1,
  id: "authFlow",
  name: "Authentication Flow",
  description: "Sign-in workflow with async actor invocation, guards, retry limit, and session expiry.",
  type: "compound",
  initial: "signedOut",
  context: {
    attempts: 0,
    maxAttempts: 3,
    user: null,
    errorMessage: null,
  },
  states: {
    signedOut: {
      type: "atomic",
      color: "slate",
      description: "Waiting for user credentials.",
      tags: ["public"],
      entry: [{ type: "clearError" }],
      on: {
        SUBMIT: [
          {
            id: "tr_submit_valid",
            target: "authenticating",
            guard: "hasValidCredentials",
            actions: [{ type: "incrementAttempts" }],
          },
          {
            id: "tr_submit_invalid",
            actions: [{ type: "setValidationError" }],
            description: "Targetless validation feedback",
          },
        ],
      },
    },
    authenticating: {
      type: "atomic",
      color: "blue",
      description: "Verifying credentials against identity service.",
      tags: ["loading"],
      invoke: [
        {
          id: "verifyCredentials",
          src: "authenticateUser",
          description: "POST /api/auth/login",
          onDone: [
            {
              id: "tr_auth_ok",
              target: "signedIn",
              actions: [{ type: "assignUser" }],
              color: "green",
            },
          ],
          onError: [
            {
              id: "tr_auth_locked",
              target: "lockedOut",
              guard: "hasExceededRetries",
              color: "red",
            },
            {
              id: "tr_auth_fail",
              target: "signedOut",
              actions: [{ type: "assignAuthError" }],
              color: "orange",
            },
          ],
        },
      ],
      on: {
        CANCEL: [
          {
            id: "tr_auth_cancel",
            target: "signedOut",
          },
        ],
      },
    },
    signedIn: {
      type: "compound",
      color: "green",
      initial: "active",
      description: "Authenticated user session.",
      tags: ["authenticated"],
      entry: [{ type: "resetAttempts" }],
      on: {
        SIGN_OUT: [
          {
            id: "tr_sign_out",
            target: "signedOut",
            actions: [{ type: "clearUser" }],
          },
        ],
      },
      states: {
        active: {
          type: "atomic",
          description: "Session is active and fresh.",
          after: {
            "5000": [
              {
                id: "tr_idle_warn",
                target: "idleWarning",
                color: "amber",
              },
            ],
          },
          on: {
            ACTIVITY: [
              {
                id: "tr_activity_ping",
                target: "active",
                reenter: true,
              },
            ],
          },
        },
        idleWarning: {
          type: "atomic",
          color: "amber",
          description: "Warn user before automatic sign-out.",
          on: {
            STAY_SIGNED_IN: [
              {
                id: "tr_stay",
                target: "active",
              },
            ],
          },
          after: {
            "3000": [
              {
                id: "tr_session_expired",
                target: "#authFlow.signedOut",
                actions: [{ type: "notifyExpired" }],
                color: "red",
              },
            ],
          },
        },
      },
    },
    lockedOut: {
      type: "atomic",
      color: "red",
      description: "Too many failed attempts; cooling down.",
      tags: ["rate-limited"],
      after: {
        "4000": [
          {
            id: "tr_cooldown_done",
            target: "signedOut",
            actions: [{ type: "resetAttempts" }],
          },
        ],
      },
    },
  },
  notes: [
    {
      id: "note_auth_1",
      text: "## Simulate tips\nSwitch to **Simulate** mode to:\n- Toggle `hasValidCredentials` & `hasExceededRetries`\n- Trigger `verifyCredentials` Done / Error\n- Fire `after` timers immediately",
      x: 44,
      y: 520,
      width: 260,
      color: "amber",
    },
  ],
};

export const MEDIA_PLAYER_PRESET: MachineDocument = {
  version: 1,
  id: "mediaPlayer",
  name: "Media Player (Parallel + History)",
  description: "Concurrent playback and audio regions with shallow history restoration.",
  type: "compound",
  initial: "ready",
  context: {
    volume: 80,
    track: "Track 01",
  },
  states: {
    ready: {
      type: "parallel",
      color: "indigo",
      description: "Playback and audio run concurrently.",
      on: {
        EJECT: [
          {
            id: "tr_eject",
            target: "empty",
          },
        ],
      },
      states: {
        playback: {
          type: "compound",
          initial: "paused",
          states: {
            paused: {
              type: "atomic",
              on: {
                PLAY: [{ id: "tr_play", target: "playing", color: "green" }],
              },
            },
            playing: {
              type: "atomic",
              color: "green",
              entry: [{ type: "startAudio" }],
              exit: [{ type: "stopAudio" }],
              on: {
                PAUSE: [{ id: "tr_pause", target: "paused" }],
                BUFFER: [{ id: "tr_buffer", target: "buffering", color: "amber" }],
                END: [{ id: "tr_ended", target: "ended" }],
              },
            },
            buffering: {
              type: "atomic",
              color: "amber",
              on: {
                READY: [{ id: "tr_buf_ready", target: "playing" }],
              },
            },
            ended: {
              type: "final",
              description: "Playback reached end of track.",
            },
            hist: {
              type: "history",
              history: "shallow",
              description: "Remembers last playback state.",
            },
          },
        },
        audio: {
          type: "compound",
          initial: "unmuted",
          states: {
            unmuted: {
              type: "atomic",
              on: {
                MUTE: [{ id: "tr_mute", target: "muted", actions: [{ type: "muteOutput" }] }],
              },
            },
            muted: {
              type: "atomic",
              color: "slate",
              on: {
                UNMUTE: [
                  { id: "tr_unmute", target: "unmuted", actions: [{ type: "restoreOutput" }] },
                ],
              },
            },
          },
        },
      },
    },
    empty: {
      type: "atomic",
      color: "slate",
      description: "No media loaded.",
      on: {
        LOAD: [
          {
            id: "tr_load_resume",
            target: "#mediaPlayer.ready.playback.hist",
          },
        ],
      },
    },
  },
  notes: [],
};

export const CHECKOUT_PRESET: MachineDocument = {
  version: 1,
  id: "checkout",
  name: "Checkout Pipeline",
  description: "Eventless `always` guard routing, nested payment flow, and `onDone` completion.",
  type: "compound",
  initial: "validatingCart",
  context: {
    items: 2,
    totalCents: 4900,
  },
  states: {
    validatingCart: {
      type: "atomic",
      color: "purple",
      description: "Checks whether the cart has items immediately on entry.",
      always: [
        {
          id: "tr_cart_ok",
          target: "payment",
          guard: "cartHasItems",
          color: "green",
        },
        {
          id: "tr_cart_empty",
          target: "emptyCart",
          color: "red",
        },
      ],
    },
    emptyCart: {
      type: "atomic",
      color: "red",
      on: {
        ADD_ITEM: [{ id: "tr_add_item", target: "validatingCart" }],
      },
    },
    payment: {
      type: "compound",
      initial: "enteringCard",
      color: "blue",
      onDone: [
        {
          id: "tr_payment_done",
          target: "confirmed",
          color: "green",
        },
      ],
      states: {
        enteringCard: {
          type: "atomic",
          on: {
            PAY: [{ id: "tr_pay", target: "charging" }],
          },
        },
        charging: {
          type: "atomic",
          color: "amber",
          invoke: [
            {
              id: "chargeCard",
              src: "stripeCharge",
              onDone: [{ id: "tr_charge_ok", target: "paid", color: "green" }],
              onError: [{ id: "tr_charge_err", target: "enteringCard", color: "red" }],
            },
          ],
        },
        paid: {
          type: "final",
        },
      },
    },
    confirmed: {
      type: "final",
      color: "green",
      description: "Order placed and receipt emailed.",
      entry: [{ type: "sendReceipt" }],
    },
  },
  notes: [],
};

export const TRAFFIC_LIGHT_PRESET: MachineDocument = {
  version: 1,
  id: "trafficLight",
  name: "Traffic Light",
  description: "Classic timed state machine with emergency override.",
  type: "compound",
  initial: "green",
  context: {
    cycles: 0,
  },
  states: {
    green: {
      type: "atomic",
      color: "green",
      tags: ["go"],
      on: {
        NEXT: [{ id: "tr_g_y", target: "yellow" }],
        EMERGENCY: [{ id: "tr_g_r", target: "red", color: "red" }],
      },
      after: {
        "3000": [{ id: "tr_g_after", target: "yellow" }],
      },
    },
    yellow: {
      type: "atomic",
      color: "amber",
      tags: ["caution"],
      on: {
        NEXT: [{ id: "tr_y_r", target: "red" }],
      },
      after: {
        "1500": [{ id: "tr_y_r_after", target: "red" }],
      },
    },
    red: {
      type: "atomic",
      color: "red",
      tags: ["stop"],
      entry: [{ type: "incrementCycles" }],
      on: {
        NEXT: [{ id: "tr_r_g", target: "green" }],
      },
      after: {
        "3000": [{ id: "tr_r_g_after", target: "green" }],
      },
    },
  },
  notes: [],
};

export const MACHINE_PRESETS: MachinePreset[] = [
  {
    id: AUTH_FLOW_PRESET.id,
    label: AUTH_FLOW_PRESET.name,
    summary: "Invoke, guards, compound states, delays & notes",
    document: AUTH_FLOW_PRESET,
  },
  {
    id: MEDIA_PLAYER_PRESET.id,
    label: MEDIA_PLAYER_PRESET.name,
    summary: "Parallel regions, history & final states",
    document: MEDIA_PLAYER_PRESET,
  },
  {
    id: CHECKOUT_PRESET.id,
    label: CHECKOUT_PRESET.name,
    summary: "Eventless `always`, nested `onDone` & invoke",
    document: CHECKOUT_PRESET,
  },
  {
    id: TRAFFIC_LIGHT_PRESET.id,
    label: TRAFFIC_LIGHT_PRESET.name,
    summary: "Simple timed transitions & override events",
    document: TRAFFIC_LIGHT_PRESET,
  },
];
