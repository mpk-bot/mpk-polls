# Slack Poll Bot 🗳️

Anonymous poll bot for Slack with hidden results until you vote or the poll is closed.

## Features

- `/poll "Question" "Option A" "Option B"` — create a poll (2–10 options)
- Anonymous voting — nobody sees who voted for what
- Hidden results until you cast your vote (shown as ephemeral message)
- One vote per person (click a different option to change)
- Poll creator can close the poll to reveal final results to everyone
- Clean Block Kit UI with vote count

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it (e.g. "Poll Bot"), pick your workspace

### 2. Configure Bot Token Scopes

Go to **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**, add:

- `chat:write`
- `commands`

### 3. Install to Workspace

**OAuth & Permissions** → **Install to Workspace** → Authorize

Copy the **Bot User OAuth Token** (`xoxb-...`) → this is your `SLACK_BOT_TOKEN`

### 4. Get Signing Secret

Go to **Basic Information** → **App Credentials** → copy **Signing Secret** → this is your `SLACK_SIGNING_SECRET`

### 5. Create Slash Command

Go to **Slash Commands** → **Create New Command**:

| Field | Value |
|---|---|
| Command | `/poll` |
| Request URL | `https://your-server.com/slack/events` |
| Short Description | Create an anonymous poll |
| Usage Hint | `"Question" "Option A" "Option B"` |

### 6. Enable Interactivity

Go to **Interactivity & Shortcuts** → toggle **On**

Set **Request URL** to: `https://your-server.com/slack/events`

### 7. Configure Environment

```bash
cp .env.example .env
# Edit .env with your tokens
```

### 8. Run

```bash
npm install
npm start
```

## Deployment Options

### Railway (free tier)

1. Push to GitHub
2. [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add env vars in Railway dashboard
4. Use the Railway URL for your slash command & interactivity URLs

### Render (free tier)

1. Push to GitHub
2. [render.com](https://render.com) → New Web Service → connect repo
3. Build command: `npm install` / Start command: `npm start`
4. Add env vars in Render dashboard

### Local (with ngrok)

```bash
npm start
# In another terminal:
ngrok http 3000
# Use the ngrok HTTPS URL for Slack config
```

## Usage

```
/poll "What's for lunch?" "Pizza" "Tacos" "Sushi"
```

- Click a button to vote
- You'll see current results (only you)
- Poll creator clicks 🔒 Close Poll to reveal final results to everyone
