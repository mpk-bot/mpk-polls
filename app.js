require('dotenv').config();
const { App, ExpressReceiver } = require('@slack/bolt');

// --- Express receiver for custom HTTP control ---
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

// --- In-memory poll storage ---
// Key: pollId (string), Value: { question, options[], votes: Map<userId, optionIndex>, creatorId, channelId, messageTs, closed }
const polls = new Map();
let pollCounter = 0;

// ============================================================
// Helpers
// ============================================================

/**
 * Parse slash command text: /poll "Question" "Opt A" "Opt B" ...
 * Supports both "quoted" and unquoted-single-word tokens.
 */
function parseCommand(text) {
  const tokens = [];
  const regex = /"([^"]+)"|"([^"]+)"|"([^"]+)"|(\S+)/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    tokens.push(m[1] || m[2] || m[3] || m[4]);
  }
  return tokens;
}

/** Build the bar chart string for an option */
function bar(count, total, width = 16) {
  const filled = total > 0 ? Math.round((count / total) * width) : 0;
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

/** Build Block Kit blocks for a poll message */
function buildPollBlocks(poll, pollId, showResults = false) {
  const totalVotes = poll.votes.size;
  const blocks = [];

  // Header
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: `*📊 ${poll.question}*` },
  });

  if (showResults) {
    // Show full results (closed poll)
    const counts = tally(poll);
    const lines = poll.options.map((opt, i) => {
      const c = counts[i] || 0;
      const pct = totalVotes > 0 ? Math.round((c / totalVotes) * 100) : 0;
      return `${bar(c, totalVotes)}  *${opt}* — ${c} vote${c !== 1 ? 's' : ''} (${pct}%)`;
    });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    });
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🗳️ *${totalVotes} vote${totalVotes !== 1 ? 's' : ''} cast* — Poll closed` }],
    });
  } else {
    // Vote buttons
    const buttons = poll.options.map((opt, i) => ({
      type: 'button',
      text: { type: 'plain_text', text: opt, emoji: true },
      action_id: `vote_${pollId}_${i}`,
      value: `${pollId}:${i}`,
    }));

    // Slack limits 5 elements per actions block — chunk them
    for (let i = 0; i < buttons.length; i += 5) {
      blocks.push({ type: 'actions', elements: buttons.slice(i, i + 5) });
    }

    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `🗳️ *${totalVotes} vote${totalVotes !== 1 ? 's' : ''} cast*` }],
    });

    // Close button (only creator can use it, but we show it — enforced in handler)
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '🔒 Close Poll', emoji: true },
        style: 'danger',
        action_id: `close_${pollId}`,
        value: pollId,
        confirm: {
          title: { type: 'plain_text', text: 'Close this poll?' },
          text: { type: 'mrkdwn', text: 'This will reveal results to everyone. This cannot be undone.' },
          confirm: { type: 'plain_text', text: 'Close It' },
          deny: { type: 'plain_text', text: 'Cancel' },
        },
      }],
    });
  }

  return blocks;
}

/** Tally votes per option index */
function tally(poll) {
  const counts = {};
  for (const idx of poll.votes.values()) {
    counts[idx] = (counts[idx] || 0) + 1;
  }
  return counts;
}

/** Build ephemeral results text */
function ephemeralResults(poll) {
  const totalVotes = poll.votes.size;
  const counts = tally(poll);
  const lines = poll.options.map((opt, i) => {
    const c = counts[i] || 0;
    const pct = totalVotes > 0 ? Math.round((c / totalVotes) * 100) : 0;
    return `${bar(c, totalVotes)}  ${opt} — ${c} (${pct}%)`;
  });
  return `*Current results for:* ${poll.question}\n\n${lines.join('\n')}\n\n_${totalVotes} total vote${totalVotes !== 1 ? 's' : ''}_`;
}

// ============================================================
// /poll slash command
// ============================================================

app.command('/poll', async ({ command, ack, respond, client }) => {
  await ack();

  const tokens = parseCommand(command.text || '');
  if (tokens.length < 3) {
    return respond({
      response_type: 'ephemeral',
      text: '⚠️ Usage: `/poll "Your question" "Option A" "Option B"` (2–10 options, quoted)',
    });
  }

  const [question, ...options] = tokens;

  if (options.length > 10) {
    return respond({
      response_type: 'ephemeral',
      text: '⚠️ Maximum 10 options allowed.',
    });
  }

  const pollId = String(++pollCounter);
  const poll = {
    question,
    options,
    votes: new Map(),
    creatorId: command.user_id,
    channelId: command.channel_id,
    messageTs: null,
    closed: false,
  };
  polls.set(pollId, poll);

  // Try to join the channel first (needed for public channels the bot isn't in)
  try {
    await client.conversations.join({ channel: command.channel_id });
  } catch (e) {
    // Ignore — will fail for DMs, private channels, or if already in channel
  }

  // Post poll to channel
  let result;
  try {
    result = await client.chat.postMessage({
      channel: command.channel_id,
      text: `📊 Poll: ${question}`,
      blocks: buildPollBlocks(poll, pollId),
    });
  } catch (e) {
    polls.delete(pollId);
    return respond({
      response_type: 'ephemeral',
      text: `⚠️ Couldn't post poll. Please invite @MPK Polls to this channel first: \`/invite @MPK Polls\``,
    });
  }

  poll.messageTs = result.ts;
});

// ============================================================
// Vote handler (dynamic action matching)
// ============================================================

app.action(/^vote_\d+_\d+$/, async ({ action, ack, body, client }) => {
  await ack();

  const [pollId, optIdx] = action.value.split(':');
  const poll = polls.get(pollId);
  if (!poll || poll.closed) return;

  const userId = body.user.id;
  const idx = parseInt(optIdx, 10);

  // Record or change vote
  poll.votes.set(userId, idx);

  // Update main message vote count
  try {
    await client.chat.update({
      channel: poll.channelId,
      ts: poll.messageTs,
      text: `📊 Poll: ${poll.question}`,
      blocks: buildPollBlocks(poll, pollId),
    });
  } catch (e) {
    console.error('Failed to update poll message:', e.message);
  }

  // Show ephemeral results to the voter
  try {
    await client.chat.postEphemeral({
      channel: poll.channelId,
      user: userId,
      text: ephemeralResults(poll),
    });
  } catch (e) {
    console.error('Failed to post ephemeral:', e.message);
  }
});

// ============================================================
// Close poll handler
// ============================================================

app.action(/^close_\d+$/, async ({ action, ack, body, client }) => {
  await ack();

  const pollId = action.value;
  const poll = polls.get(pollId);
  if (!poll || poll.closed) return;

  // Only creator can close
  if (body.user.id !== poll.creatorId) {
    try {
      await client.chat.postEphemeral({
        channel: poll.channelId,
        user: body.user.id,
        text: '⚠️ Only the poll creator can close this poll.',
      });
    } catch (e) { /* ignore */ }
    return;
  }

  poll.closed = true;

  // Update message with full results
  try {
    await client.chat.update({
      channel: poll.channelId,
      ts: poll.messageTs,
      text: `📊 Poll (closed): ${poll.question}`,
      blocks: buildPollBlocks(poll, pollId, true),
    });
  } catch (e) {
    console.error('Failed to close poll:', e.message);
  }
});

// ============================================================
// Health check
// ============================================================

receiver.router.get('/health', (_req, res) => res.json({ ok: true }));

// ============================================================
// Start
// ============================================================

const PORT = process.env.PORT || 3000;
(async () => {
  await app.start(PORT);
  console.log(`⚡ Poll bot running on port ${PORT}`);
})();
