import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Card, Chip, ErrorText, Field, Screen, Section } from '../../src/components/Screen';
import { skillLabel } from '../../src/components/ProviderCard';
import {
  addRateCardItem,
  deleteService,
  getMyProfile,
  getMyProvider,
  listCategories,
  listMyServices,
  upsertProviderProfile,
  upsertService,
} from '../../src/lib/api';
import { useCurrentLocation } from '../../src/lib/location';
import { formatINR, rupeesToPaise } from '../../src/lib/money';
import { colors, font, minTouch, spacing } from '../../src/lib/theme';
import type { Category, Provider, ProviderService, RateUnit, SkillLevel } from '../../src/lib/types';

const LEVELS: SkillLevel[] = ['beginner', 'skilled', 'expert', 'certified'];

export default function ProviderOnboarding() {
  const location = useCurrentLocation(false);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [radiusKm, setRadiusKm] = useState('10');
  const [years, setYears] = useState('0');
  const [languages, setLanguages] = useState('English, Hindi');

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [level, setLevel] = useState<SkillLevel>('skilled');
  const [visitFee, setVisitFee] = useState('199');
  const [labourRate, setLabourRate] = useState('');
  const [rateUnit, setRateUnit] = useState<RateUnit>('job');

  const reload = useCallback(async () => {
    try {
      const [p, profile, cats] = await Promise.all([getMyProvider(), getMyProfile(), listCategories()]);
      setCategories(cats);
      setFullName((n) => n || profile?.full_name || '');
      if (p) {
        setProvider(p);
        setBio(p.bio);
        setCity(p.city);
        setRadiusKm(String(p.service_radius_km));
        setYears(String(p.years_experience));
        setLanguages(p.languages.join(', '));
        setServices(await listMyServices());
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (location.city && !city) setCity(location.city);
  }, [location.city, city]);

  const saveProfile = async () => {
    if (!city.trim()) return setError('City is required.');
    setSaving(true);
    setError(null);
    try {
      await upsertProviderProfile({
        fullName,
        bio,
        city,
        serviceRadiusKm: Math.min(Math.max(Number(radiusKm) || 10, 1), 100),
        coords: location.coords,
        yearsExperience: Math.min(Math.max(Number(years) || 0, 0), 60),
        languages: languages.split(',').map((l) => l.trim()).filter(Boolean),
      });
      setSaved(true);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addService = async () => {
    if (!categoryId) return setError('Pick a service category.');
    const fee = Number(visitFee);
    const labour = Number(labourRate);
    if (!(fee >= 0) || !(labour >= 0) || labourRate === '') return setError('Enter a visit fee and labour rate.');
    setError(null);
    try {
      await upsertService({
        categoryId,
        skillLevel: level,
        visitFee: rupeesToPaise(fee),
        labourRate: rupeesToPaise(labour),
        rateUnit,
      });
      setCategoryId(null);
      setLabourRate('');
      setServices(await listMyServices());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Screen>
      <Section title="Your profile">
        <Field label="Full name" value={fullName} onChangeText={setFullName} />
        <Field label="Short bio" multiline value={bio} onChangeText={setBio} maxLength={500} />
        <Field label="City" value={city} onChangeText={setCity} />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field label="Service radius (km)" keyboardType="number-pad" value={radiusKm} onChangeText={setRadiusKm} />
          </View>
          <View style={styles.flex}>
            <Field label="Years of experience" keyboardType="number-pad" value={years} onChangeText={setYears} />
          </View>
        </View>
        <Field label="Languages (comma separated)" value={languages} onChangeText={setLanguages} />
        <Button
          title={location.coords ? 'Base location set ✓' : 'Set base location (current position)'}
          variant="secondary"
          onPress={() => void location.refresh()}
          loading={location.loading}
        />
        <Button title={provider ? 'Save profile' : 'Create provider profile'} onPress={saveProfile} loading={saving} />
        {saved && <Text style={{ color: colors.success }}>Saved.</Text>}
      </Section>

      <Card style={{ backgroundColor: colors.primarySoft }}>
        <Text style={font.heading}>Verification</Text>
        <Text style={font.body}>
          Verification is done via our payment partner during payout setup. You will appear in search once your payout
          account is activated.
        </Text>
        <Text style={font.caption}>Status: {provider?.kyc_status ?? 'not started'}</Text>
      </Card>

      {provider && (
        <Section title="Skills & fees">
          {services.map((s) => (
            <ServiceRow
              key={s.id}
              service={s}
              onDelete={async () => {
                await deleteService(s.id).catch((e: Error) => setError(e.message));
                setServices(await listMyServices());
              }}
              onAddRate={async (title, price) => {
                await addRateCardItem(s.id, title, price).catch((e: Error) => setError(e.message));
                setServices(await listMyServices());
              }}
            />
          ))}
          <Card>
            <Text style={font.heading}>Add a skill</Text>
            <View style={styles.chips}>
              {categories.map((c) => (
                <Chip key={c.id} label={c.name} selected={categoryId === c.id} onPress={() => setCategoryId(c.id)} />
              ))}
            </View>
            <Text style={[font.caption, { fontWeight: '600' }]}>Skill level</Text>
            <View style={styles.chips}>
              {LEVELS.map((l) => (
                <Chip key={l} label={skillLabel[l]} selected={level === l} onPress={() => setLevel(l)} />
              ))}
            </View>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Field label="Visit fee ₹" keyboardType="decimal-pad" value={visitFee} onChangeText={setVisitFee} />
              </View>
              <View style={styles.flex}>
                <Field label="Labour rate ₹" keyboardType="decimal-pad" value={labourRate} onChangeText={setLabourRate} />
              </View>
            </View>
            <View style={styles.chips}>
              <Chip label="per job" selected={rateUnit === 'job'} onPress={() => setRateUnit('job')} />
              <Chip label="per hour" selected={rateUnit === 'hour'} onPress={() => setRateUnit('hour')} />
            </View>
            <Text style={font.caption}>Typical visit fee band: ₹99–₹299.</Text>
            <Button title="Save skill" onPress={addService} />
          </Card>
        </Section>
      )}
      <ErrorText message={error} />
      {provider && <Button title="Go to dashboard" variant="ghost" onPress={() => router.replace('/dashboard')} />}
    </Screen>
  );
}

function ServiceRow(props: {
  service: ProviderService;
  onDelete: () => void;
  onAddRate: (title: string, price: number) => void;
}) {
  const { service: s } = props;
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  return (
    <Card>
      <View style={styles.between}>
        <Text style={font.heading}>{s.categories?.name}</Text>
        <Pressable accessibilityRole="button" onPress={props.onDelete} style={styles.touch}>
          <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text>
        </Pressable>
      </View>
      <Text style={font.caption}>
        {skillLabel[s.skill_level]} • Visit {formatINR(s.visit_fee)} • Labour {formatINR(s.labour_rate)}/{s.rate_unit}
      </Text>
      {(s.rate_card_items ?? []).map((r) => (
        <Text key={r.id} style={font.body}>
          {r.title} — {formatINR(r.price)}
        </Text>
      ))}
      <View style={styles.row}>
        <View style={{ flex: 2 }}>
          <Field label="Rate card item" placeholder="Gas refill" value={title} onChangeText={setTitle} />
        </View>
        <View style={styles.flex}>
          <Field label="Price ₹" keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
        </View>
      </View>
      <Button
        title="Add to rate card"
        variant="secondary"
        disabled={!title.trim() || !(Number(price) > 0)}
        onPress={() => {
          props.onAddRate(title.trim(), rupeesToPaise(Number(price)));
          setTitle('');
          setPrice('');
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  touch: { minHeight: minTouch, justifyContent: 'center' },
});
