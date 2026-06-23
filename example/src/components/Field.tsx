import { type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { colors, radius, spacing, type } from '../theme';

export interface FieldProps extends TextInputProps {
  label?: string;
  hint?: string;
  right?: ReactNode;
}

export default function Field({
  label,
  hint,
  right,
  style,
  multiline,
  ...rest
}: FieldProps) {
  return (
    <View style={styles.wrap}>
      {label ? (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {right}
        </View>
      ) : null}
      <TextInput
        placeholderTextColor={colors.textDim}
        {...rest}
        multiline={multiline}
        style={[styles.input, multiline && styles.inputMultiline, style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.md,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    ...type.smallMedium,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: 15,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  hint: {
    ...type.small,
    color: colors.textDim,
    marginTop: 6,
  },
});
