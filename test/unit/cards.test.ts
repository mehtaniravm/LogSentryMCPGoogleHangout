import { describe, it, expect } from 'vitest';
import {
  buildAlertCard,
  buildAnswerCard,
  buildCloudLoggingUrl,
  colorForScore,
} from '../../src/chat/cards.js';
import type { Anomaly } from '../../src/logging/types.js';

function anomaly(over: Partial<Anomaly>): Anomaly {
  return {
    service: 'svc',
    type: 'error_rate',
    detail: 'detail',
    observed: 10,
    threshold: 5,
    severityScore: 50,
    sampleMessages: [],
    ...over,
  };
}

describe('colorForScore', () => {
  it('bands scores into green/amber/red', () => {
    expect(colorForScore(5)).toBe('green');
    expect(colorForScore(20)).toBe('amber');
    expect(colorForScore(150)).toBe('red');
  });
});

describe('buildAlertCard', () => {
  it('uses a red header for a critical anomaly and includes service + observed vs threshold', () => {
    const a = anomaly({
      type: 'fatal',
      service: 'payment-service',
      observed: 2,
      threshold: 0,
      severityScore: 200,
      sampleMessages: ['OOM 1', 'OOM 2', 'OOM 3', 'OOM 4'],
    });
    const card = buildAlertCard([a]);
    expect(card.color).toBe('red');
    expect(card.cardsV2[0]!.card.header.title).toContain('🔴');
    const section = card.cardsV2[0]!.card.sections[0]!;
    const json = JSON.stringify(section);
    expect(json).toContain('payment-service');
    expect(json).toContain('observed 2 vs threshold 0');
    // at most 3 sample lines rendered
    const sampleWidgets = section.widgets.filter(
      (w) => 'textParagraph' in w && w.textParagraph.text.startsWith('•'),
    );
    expect(sampleWidgets).toHaveLength(3);
  });

  it('renders one section per anomaly, ordered by severityScore desc', () => {
    const low = anomaly({ service: 'a', severityScore: 10 });
    const high = anomaly({ service: 'b', severityScore: 300, type: 'fatal' });
    const card = buildAlertCard([low, high]);
    const sections = card.cardsV2[0]!.card.sections;
    expect(sections).toHaveLength(2);
    expect(sections[0]!.header).toContain('b');
    expect(sections[1]!.header).toContain('a');
  });

  it('includes a View in Cloud Logging button whose URL has the service and time range', () => {
    const card = buildAlertCard([anomaly({ service: 'cart-service' })], {
      projectId: 'proj-1',
      now: new Date('2026-06-03T12:00:00.000Z'),
      windowMinutes: 30,
    });
    const json = JSON.stringify(card);
    expect(json).toContain('View in Cloud Logging');
    expect(json).toContain(encodeURIComponent('resource.labels.service_name="cart-service"'));
    expect(json).toContain('timeRange=');
    expect(json).toContain(encodeURIComponent('2026-06-03T11:30:00.000Z'));
  });
});

describe('buildCloudLoggingUrl', () => {
  it('encodes service and a start/end time range', () => {
    const url = buildCloudLoggingUrl('svc', {
      projectId: 'p',
      now: new Date('2026-06-03T12:00:00.000Z'),
      windowMinutes: 60,
    });
    expect(url).toContain('project=p');
    expect(url).toContain(encodeURIComponent('2026-06-03T11:00:00.000Z'));
    expect(url).toContain(encodeURIComponent('2026-06-03T12:00:00.000Z'));
  });
});

describe('buildAnswerCard', () => {
  it('renders question, answer, and sources', () => {
    const card = buildAnswerCard('is payment-service healthy?', 'Yes, looks healthy.', [
      'get_service_health',
    ]);
    const json = JSON.stringify(card);
    expect(json).toContain('is payment-service healthy?');
    expect(json).toContain('Yes, looks healthy.');
    expect(json).toContain('get_service_health');
  });
});
