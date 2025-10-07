import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  type TextInputProps,
} from 'react-native';

export type Option = { label: string; value: string };

const CUSTOM_VALUE = '__custom__';

export interface OptionSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  allowCustom?: boolean;
  customPlaceholder?: string;
  customKeyboardType?: TextInputProps['keyboardType'];
}

const OptionSelect = ({
  label,
  value,
  onChange,
  options,
  placeholder,
  allowCustom = false,
  customPlaceholder,
  customKeyboardType,
}: OptionSelectProps) => {
  const [isModalVisible, setModalVisible] = useState(false);
  const optionMap = useMemo(
    () => new Map(options.map((option) => [option.value, option.label])),
    [options]
  );

  const [isCustom, setIsCustom] = useState(
    () => allowCustom && !optionMap.has(value)
  );

  useEffect(() => {
    if (!allowCustom) return;
    setIsCustom(!optionMap.has(value));
  }, [allowCustom, optionMap, value]);

  const selectedLabel = optionMap.get(value);
  const displayValue = selectedLabel
    ? selectedLabel
    : allowCustom && isCustom
      ? value
        ? `Custom: ${value}`
        : 'Custom value…'
      : value
        ? value
        : (placeholder ?? 'Select an option');

  const handleSelect = (selected: string) => {
    if (allowCustom && selected === CUSTOM_VALUE) {
      setIsCustom(true);
      setModalVisible(false);
      onChange('');
      return;
    }

    setIsCustom(false);
    onChange(selected);
    setModalVisible(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={styles.dropdown}
        onPress={() => setModalVisible(true)}
        accessibilityRole="button"
        accessibilityLabel={`Select ${label}`}
      >
        <Text
          style={
            value || selectedLabel
              ? styles.dropdownValue
              : styles.dropdownPlaceholder
          }
        >
          {displayValue}
        </Text>
        <Text style={styles.dropdownIcon}>▾</Text>
      </Pressable>

      {allowCustom && isCustom && (
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={customPlaceholder}
          style={[styles.input, styles.customInput]}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={customKeyboardType}
        />
      )}

      <Modal
        visible={isModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setModalVisible(false)}>
            <View style={styles.modalBackdrop} />
          </TouchableWithoutFeedback>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView>
              {options.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={styles.modalOption}
                  onPress={() => handleSelect(option.value)}
                >
                  <Text style={styles.modalOptionText}>{option.label}</Text>
                </TouchableOpacity>
              ))}
              {allowCustom && (
                <TouchableOpacity
                  key="custom"
                  style={styles.modalOption}
                  onPress={() => handleSelect(CUSTOM_VALUE)}
                >
                  <Text style={styles.modalOptionText}>Custom value…</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default OptionSelect;

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#444',
    marginBottom: 4,
  },
  dropdown: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownValue: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  dropdownPlaceholder: {
    fontSize: 14,
    color: '#888',
    flex: 1,
  },
  dropdownIcon: {
    fontSize: 16,
    color: '#666',
    marginLeft: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 8,
    backgroundColor: '#fff',
  },
  customInput: {
    marginTop: 8,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  modalSheet: {
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#222',
  },
  modalOption: {
    paddingVertical: 12,
  },
  modalOptionText: {
    fontSize: 15,
    color: '#333',
  },
});
