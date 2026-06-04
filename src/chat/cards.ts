import type { Anomaly } from '../logging/types.js';

export type CardColor = 'green' | 'amber' | 'red';

/** Google Chat cardsV2 payload plus a convenience `color` for logic/tests. */
export interface ChatCard {
  color: CardColor;
  text?: string;
  cardsV2: Array<{
    cardId: string;
    card: {
      header: { title: string; subtitle?: string };
      sections: Array<{ header?: string; widgets: Widget[] }>;
    };
  }>;
}

type Widget =
  | { decoratedText: { text: string; topLabel?: string; wrapText?: boolean } }
  | { textParagraph: { text: string } }
  | { buttonList: { buttons: Array<{ text: string; onClick: { openLink: { url: string } } }> } };

const COLOR_EMOJI: Record<CardColor, string> = { green: '🟢', amber: '🟡', red: '🔴' };

/** Map the highest severity score across anomalies to a card color band. */
export function colorForScore(maxScore: number): CardColor {
  if (maxScore >= 100) return 'red';
  if (maxScore >= 20) return 'amber';
  return 'green';
}

export interface CloudLoggingLinkOpts {
  projectId?: string;
  windowMinutes?: number;
  now?: Date;
}

/** Build a Cloud Logging console deep link for a service + time window. */
export function buildCloudLoggingUrl(service: string, opts: CloudLoggingLinkOpts = {}): string {
  const now = opts.now ?? new Date();
  const windowMinutes = opts.windowMinutes ?? 60;
  const start = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const end = now.toISOString();
  const query = `resource.labels.service_name="${service}"`;
  const project = opts.projectId ?? 'PROJECT_ID';
  const timeRange = `${encodeURIComponent(start)}/${encodeURIComponent(end)}`;
  return (
    `https://console.cloud.google.com/logs/query;` +
    `query=${encodeURIComponent(query)};` +
    `timeRange=${timeRange}?project=${encodeURIComponent(project)}`
  );
}

function anomalySection(a: Anomaly, opts: CloudLoggingLinkOpts) {
  const widgets: Widget[] = [
    {
      decoratedText: {
        topLabel: `${a.service} — ${a.type}`,
        text: `${a.detail}  (observed ${a.observed} vs threshold ${a.threshold})`,
        wrapText: true,
      },
    },
  ];
  for (const msg of a.sampleMessages.slice(0, 3)) {
    widgets.push({ textParagraph: { text: `• ${msg}` } });
  }
  widgets.push({
    buttonList: {
      buttons: [
        {
          text: 'View in Cloud Logging',
          onClick: { openLink: { url: buildCloudLoggingUrl(a.service, opts) } },
        },
      ],
    },
  });
  return { header: `${a.service} · ${a.type}`, widgets };
}

/** Build an alert card from one or more anomalies (ordered by severity desc). */
export function buildAlertCard(anomalies: Anomaly[], opts: CloudLoggingLinkOpts = {}): ChatCard {
  const sorted = [...anomalies].sort((a, b) => b.severityScore - a.severityScore);
  const maxScore = sorted[0]?.severityScore ?? 0;
  const color = colorForScore(maxScore);
  const count = sorted.length;
  return {
    color,
    cardsV2: [
      {
        cardId: 'logsentry-alert',
        card: {
          header: {
            title: `${COLOR_EMOJI[color]} LogSentry Alert — ${count} anomaly${count === 1 ? '' : 'ies'}`,
            subtitle: `Highest severity score: ${maxScore}`,
          },
          sections: sorted.map((a) => anomalySection(a, opts)),
        },
      },
    ],
  };
}

/** Build an answer card for an interactive Q&A reply. */
export function buildAnswerCard(question: string, answer: string, sources: string[] = []): ChatCard {
  const widgets: Widget[] = [
    { decoratedText: { topLabel: 'Question', text: question, wrapText: true } },
    { textParagraph: { text: answer } },
  ];
  if (sources.length > 0) {
    widgets.push({ textParagraph: { text: `Sources: ${sources.join(', ')}` } });
  }
  return {
    color: 'green',
    cardsV2: [
      {
        cardId: 'logsentry-answer',
        card: {
          header: { title: '💬 LogSentry' },
          sections: [{ widgets }],
        },
      },
    ],
  };
}
