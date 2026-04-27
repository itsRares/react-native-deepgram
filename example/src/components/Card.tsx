import { type ReactNode, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewProps,
} from 'react-native';
import { colors, radius, spacing, type } from '../theme';

export interface CardProps extends ViewProps {
  title?: string;
  subtitle?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  right?: ReactNode;
  children?: ReactNode;
}

export default function Card({
  title,
  subtitle,
  collapsible,
  defaultCollapsed = false,
  right,
  children,
  style,
  ...rest
}: CardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const HeaderTag = collapsible ? Pressable : View;

  return (
    <View style={[styles.card, style]} {...rest}>
      {(title || right) && (
        <HeaderTag
          onPress={collapsible ? () => setCollapsed((c) => !c) : undefined}
          style={styles.header}
        >
          <View style={styles.headerText}>
            {title ? <Text style={styles.title}>{title}</Text> : null}
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {right}
          {collapsible ? (
            <Text style={styles.chevron}>{collapsed ? '▾' : '▴'}</Text>
          ) : null}
        </HeaderTag>
      )}
      {!collapsed && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  title: {
    ...type.h3,
    color: colors.text,
  },
  subtitle: {
    ...type.small,
    color: colors.textMuted,
    marginTop: 2,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
});
