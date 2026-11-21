import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { addAddress } from '../lib/api';
import { locateWithGps } from '../lib/locationContext';
import type { SelectedLocation } from '../lib/locationModel';
import type { SavedAddress } from '../lib/types';
import { useTheme } from '../theme';
import { BottomSheet, Button, Chip, InlineAlert, Input, Text } from './ui';

const LABELS = [
  { value: 'Home', icon: 'home-outline' },
  { value: 'Work', icon: 'briefcase-outline' },
  { value: 'Other', icon: 'location-outline' },
] as const;

export function addressIcon(label: string | null | undefined): 'home-outline' | 'briefcase-outline' | 'location-outline' {
  const l = (label ?? '').toLowerCase();
  if (l === 'home') return 'home-outline';
  if (l === 'work' || l === 'office') return 'briefcase-outline';
  return 'location-outline';
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Where the map pin goes (the current selection); the user can re-pin to GPS. */
  pin: SelectedLocation;
  onSaved: (a: SavedAddress) => void;
  title?: string;
  ownerId?: string | null;
}

/** "Add address" sheet: label chips, house/street line, city, and the pin used for distance matching. */
export function AddressEditorSheet({ visible, onClose, pin: initialPin, onSaved, title = 'Add address', ownerId }: Props) {
  const t = useTheme();
  const ownerIdRef = useRef(ownerId);
  const editorEpochRef = useRef(0);
  ownerIdRef.current = ownerId;
  const [label, setLabel] = useState<string>('Home');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [pin, setPin] = useState(initialPin);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    editorEpochRef.current += 1;
    if (!visible) {
      setBusy(false);
      setLocating(false);
      return;
    }
    setPin(initialPin);
    setLabel('Home');
    setLine1(initialPin.line1 ?? '');
    setCity(initialPin.city);
    setError(null);
    setTouched(false);
  }, [visible, initialPin, ownerId]);

  const repin = async () => {
    const epoch = editorEpochRef.current;
    const requestedOwner = ownerId;
    setLocating(true);
    const r = await locateWithGps();
    if (
      epoch !== editorEpochRef.current ||
      (requestedOwner !== undefined && ownerIdRef.current !== requestedOwner)
    ) return;
    setLocating(false);
    if (r.ok) {
      setPin(r.location);
      if (!line1.trim() && r.location.line1) setLine1(r.location.line1);
      if (r.location.city) setCity(r.location.city);
    } else setError(r.message);
  };

  const lineError = touched && !line1.trim() ? 'Add house / flat number and street.' : null;
  const cityError = touched && !city.trim() ? 'Enter the city.' : null;

  const save = async () => {
    setTouched(true);
    if (!line1.trim() || !city.trim() || ownerId === null) return;
    const epoch = editorEpochRef.current;
    const requestedOwner = ownerId;
    setBusy(true);
    setError(null);
    try {
      const saved = await addAddress({ label, line1, city, lat: pin.lat, lng: pin.lng });
      if (
        epoch !== editorEpochRef.current ||
        (requestedOwner !== undefined && ownerIdRef.current !== requestedOwner)
      ) return;
      onSaved(saved);
    } catch (e) {
      if (
        epoch === editorEpochRef.current &&
        (requestedOwner === undefined || ownerIdRef.current === requestedOwner)
      ) setError((e as Error).message);
    } finally {
      if (
        epoch === editorEpochRef.current &&
        (requestedOwner === undefined || ownerIdRef.current === requestedOwner)
      ) setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle="Shared with your pro only after they accept"
      footer={<Button title="Save address" onPress={() => void save()} loading={busy} size="lg" fullWidth />}
    >
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="subheadStrong" color="textSecondary">
          Save as
        </Text>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          {LABELS.map((l) => (
            <Chip key={l.value} label={l.value} icon={l.icon} selected={label === l.value} onPress={() => setLabel(l.value)} />
          ))}
        </View>
      </View>
      <Input
        label="House / flat no., street, landmark"
        placeholder="e.g. Flat 302, Sri Sai Residency, 4th Lane"
        value={line1}
        onChangeText={setLine1}
        error={lineError}
        maxLength={160}
        accessibilityLabel="House, flat number and street"
      />
      <Input label="City" value={city} onChangeText={setCity} error={cityError} maxLength={60} accessibilityLabel="City" />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: t.spacing.md,
          padding: t.spacing.md,
          borderRadius: t.radii.md,
          backgroundColor: t.colors.surfaceAlt,
        }}
      >
        <Ionicons name="pin-outline" size={20} color={t.colors.textSecondary} />
        <View style={{ flex: 1 }}>
          <Text variant="footnote" color="muted">
            Map pin
          </Text>
          <Text variant="subheadStrong" numberOfLines={1}>
            {pin.area}, {pin.city}
          </Text>
        </View>
        <Button title="Use GPS" variant="ghost" size="sm" leftIcon="locate-outline" loading={locating} onPress={() => void repin()} />
      </View>
      <InlineAlert message={error} />
    </BottomSheet>
  );
}
