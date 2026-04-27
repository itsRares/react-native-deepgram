import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useDeepgramTextIntelligence } from 'react-native-deepgram';
import Button from './components/Button';
import Card from './components/Card';
import Field from './components/Field';
import StatusBadge from './components/StatusBadge';
import { colors, radius, spacing, type } from './theme';

const SAMPLE_TEXT =
  'Yesterday I listened to an incredible podcast about the first commercial spacewalk — really inspiring stuff. I want to start my own podcast about exploration!';

type AnalyzeResult = {
  results?: {
    summary?: { text?: string };
    topics?: {
      segments?: Array<{
        text?: string;
        topics?: Array<{ topic?: string; confidence_score?: number }>;
      }>;
    };
    intents?: {
      segments?: Array<{
        text?: string;
        intents?: Array<{ intent?: string; confidence_score?: number }>;
      }>;
    };
    sentiments?: {
      average?: { sentiment?: string; sentiment_score?: number };
      segments?: Array<{
        text?: string;
        sentiment?: string;
        sentiment_score?: number;
      }>;
    };
  };
};

export default function TextIntelligence() {
  const [input, setInput] = useState<string>('');
  const [result, setResult] = useState<AnalyzeResult | null>(null);

  const { analyze, state } = useDeepgramTextIntelligence({
    trackState: true,
    options: {
      summarize: true,
      topics: true,
      customTopic: ['Spacewalk', 'Podcast'],
      customTopicMode: 'extended',
      intents: true,
      customIntent: ['Encourage podcasting'],
      customIntentMode: 'extended',
      sentiment: true,
      language: 'en-US',
    },
    onBeforeAnalyze: () => setResult(null),
    onAnalyzeSuccess: (r: unknown) => setResult(r as AnalyzeResult),
  });

  const isAnalyzing = state?.status === 'analyzing';
  const tone = state?.error ? 'error' : isAnalyzing ? 'connecting' : 'idle';
  const toneLabel = state?.error ? 'Error' : isAnalyzing ? 'Analyzing' : 'Idle';

  const summary = result?.results?.summary?.text;
  const topicSegments = result?.results?.topics?.segments ?? [];
  const intentSegments = result?.results?.intents?.segments ?? [];
  const sentimentAvg = result?.results?.sentiments?.average;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <StatusBadge tone={tone} label={toneLabel} />
          </View>
          <Text style={styles.heroIcon}>🧠</Text>
          <Text style={styles.heroTitle}>Text Intelligence</Text>
          <Text style={styles.heroSubtitle}>
            Run summarization, topic + intent detection, and sentiment analysis
            in one request.
          </Text>
        </View>

        <Card title="Input text">
          <Field
            value={input}
            onChangeText={setInput}
            placeholder="Paste or type text to analyze…"
            multiline
            numberOfLines={6}
          />
          <View style={styles.actionRow}>
            <Button
              title="Analyze"
              variant="primary"
              onPress={() => analyze({ text: input })}
              loading={isAnalyzing}
              disabled={isAnalyzing || !input.trim()}
              iconLeft="✨"
            />
            <Button
              title="Use sample"
              variant="ghost"
              onPress={() => setInput(SAMPLE_TEXT)}
            />
          </View>
          {state?.error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠ {state.error.message}</Text>
            </View>
          ) : null}
        </Card>

        {result ? (
          <>
            {summary ? (
              <Card title="Summary" subtitle="AI-generated">
                <Text style={styles.bodyText}>{summary}</Text>
              </Card>
            ) : null}

            {sentimentAvg ? (
              <Card title="Sentiment" subtitle="Average across input">
                <View style={styles.sentimentRow}>
                  <SentimentBadge value={sentimentAvg.sentiment} />
                  <Text style={styles.sentimentScore}>
                    Score:{' '}
                    {sentimentAvg.sentiment_score != null
                      ? sentimentAvg.sentiment_score.toFixed(3)
                      : '–'}
                  </Text>
                </View>
              </Card>
            ) : null}

            {topicSegments.length > 0 ? (
              <Card
                title="Topics"
                subtitle={`${topicSegments.length} segment(s)`}
              >
                {topicSegments.map((seg, i) => (
                  <View key={i} style={styles.segment}>
                    <Text style={styles.segmentText}>{seg.text}</Text>
                    <View style={styles.chipRow}>
                      {seg.topics?.map((t, ti) => (
                        <View
                          key={`${t.topic}-${ti}`}
                          style={[styles.chip, styles.chipAccent]}
                        >
                          <Text style={styles.chipTextAccent}>
                            {t.topic}
                            {t.confidence_score != null
                              ? ` · ${(t.confidence_score * 100).toFixed(0)}%`
                              : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}

            {intentSegments.length > 0 ? (
              <Card
                title="Intents"
                subtitle={`${intentSegments.length} segment(s)`}
              >
                {intentSegments.map((seg, i) => (
                  <View key={i} style={styles.segment}>
                    <Text style={styles.segmentText}>{seg.text}</Text>
                    <View style={styles.chipRow}>
                      {seg.intents?.map((t, ti) => (
                        <View
                          key={`${t.intent}-${ti}`}
                          style={[styles.chip, styles.chipPrimary]}
                        >
                          <Text style={styles.chipTextPrimary}>
                            {t.intent}
                            {t.confidence_score != null
                              ? ` · ${(t.confidence_score * 100).toFixed(0)}%`
                              : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}

            <Card
              title="Raw response"
              subtitle="Full Deepgram payload"
              collapsible
              defaultCollapsed
            >
              <ScrollView horizontal>
                <Text style={styles.json}>
                  {JSON.stringify(result, null, 2)}
                </Text>
              </ScrollView>
            </Card>
          </>
        ) : (
          <Card>
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyText}>
                Results will appear here after analysis.
              </Text>
            </View>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function SentimentBadge({ value }: { value: string | undefined }) {
  const map: Record<string, { color: string; bg: string; label: string }> = {
    positive: { color: colors.success, bg: '#0f2f24', label: '😀 Positive' },
    neutral: {
      color: colors.textMuted,
      bg: colors.surfaceMuted,
      label: '😐 Neutral',
    },
    negative: { color: colors.danger, bg: '#3a1418', label: '☹️ Negative' },
  };
  const style = map[value ?? 'neutral'] ?? map.neutral!;
  return (
    <View style={[styles.sentimentBadge, { backgroundColor: style.bg }]}>
      <Text style={{ color: style.color, ...type.bodyMedium }}>
        {style.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  heroTop: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: spacing.md,
  },
  heroIcon: { fontSize: 40, marginBottom: spacing.sm },
  heroTitle: { ...type.h2, color: colors.text },
  heroSubtitle: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  errorBanner: {
    backgroundColor: '#3a1418',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: { color: colors.danger, ...type.smallMedium },
  bodyText: { ...type.body, color: colors.text, lineHeight: 22 },
  sentimentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sentimentBadge: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  sentimentScore: { ...type.small, color: colors.textMuted },
  segment: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  segmentText: {
    ...type.small,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginBottom: 6,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipAccent: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accentMuted,
  },
  chipTextAccent: {
    color: colors.accent,
    ...type.smallMedium,
    fontSize: 12,
  },
  chipPrimary: {
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primaryMuted,
  },
  chipTextPrimary: {
    color: colors.primary,
    ...type.smallMedium,
    fontSize: 12,
  },
  json: {
    fontFamily: 'Menlo',
    color: colors.textMuted,
    fontSize: 12,
  },
  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyIcon: { fontSize: 28, marginBottom: spacing.sm },
  emptyText: { ...type.small, color: colors.textMuted },
});
