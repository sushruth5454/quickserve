import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { CategoryIcon, iconForSlug } from '../src/components/CategoryIcon';
import { SkillBadge, skillLabel } from '../src/components/ProviderCard';
import {
  Badge,
  Button,
  Card,
  Chip,
  Header,
  IconButton,
  InlineAlert,
  Input,
  Screen,
  SegmentedControl,
  StepIndicator,
  Stepper,
  Text,
  TextArea,
  useConfirm,
  useToast,
} from '../src/components/ui';
import {
  addRateCardItem,
  deleteService,
  getMyProfile,
  getMyProvider,
  listCategories,
  listMyServices,
  upsertProviderProfile,
  upsertService,
} from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { useCurrentLocation } from '../src/lib/location';
import { formatINR, rupeesToPaise } from '../src/lib/money';
import type { Category, Provider, ProviderService, RateUnit, SkillLevel } from '../src/lib/types';
import { useTheme } from '../src/theme';

const STEPS = ['Profile', 'Skills', 'Payouts'];
const LEVELS: SkillLevel[] = ['beginner', 'skilled', 'expert', 'certified'];
const LANGUAGES = ['Telugu', 'Hindi', 'English', 'Tamil', 'Kannada', 'Urdu', 'Marathi', 'Bengali'];

export default function ProviderOnboarding() {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { setActiveRole } = useAuth();
  const location = useCurrentLocation(false);
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<ProviderService[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [radiusKm, setRadiusKm] = useState(10);
  const [years, setYears] = useState(0);
  const [languages, setLanguages] = useState<string[]>(['Telugu', 'English']);

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
        setRadiusKm(p.service_radius_km);
        setYears(p.years_experience);
        if (p.languages.length) setLanguages(p.languages);
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
    if (!fullName.trim()) return setError('Enter your name as customers will see it.');
    if (!city.trim()) return setError('City is required.');
    setSaving(true);
    setError(null);
    try {
      await upsertProviderProfile({
        fullName: fullName.trim(),
        bio: bio.trim(),
        city: city.trim(),
        serviceRadiusKm: Math.min(Math.max(radiusKm, 1), 100),
        coords: location.coords,
        yearsExperience: Math.min(Math.max(years, 0), 60),
        languages,
      });
      await reload();
      setStep(1);
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
    if (!(fee >= 0) || !(labour >= 0) || labourRate === '' || visitFee === '') return setError('Enter a visit fee and labour rate.');
    setError(null);
    setSaving(true);
    try {
      await upsertService({ categoryId, skillLevel: level, visitFee: rupeesToPaise(fee), labourRate: rupeesToPaise(labour), rateUnit });
      setCategoryId(null);
      setLabourRate('');
      setServices(await listMyServices());
      toast({ message: 'Skill saved', tone: 'success' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const finish = () => {
    setActiveRole('provider');
    router.replace('/dashboard');
  };

  const footer =
    step === 0 ? (
      <Button title={provider ? 'Save & continue' : 'Create profile & continue'} onPress={() => void saveProfile()} loading={saving} size="lg" rightIcon="arrow-forward" fullWidth />
    ) : step === 1 ? (
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Button title="Back" variant="outline" onPress={() => setStep(0)} style={{ flex: 1 }} size="lg" />
        <Button
          title="Continue"
          rightIcon="arrow-forward"
          disabled={services.length === 0}
          onPress={() => setStep(2)}
          style={{ flex: 2 }}
          size="lg"
        />
      </View>
    ) : (
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Button title="Back" variant="outline" onPress={() => setStep(1)} style={{ flex: 1 }} size="lg" />
        <Button title="Go to dashboard" rightIcon="checkmark" onPress={finish} style={{ flex: 2 }} size="lg" variant="success" />
      </View>
    );

  return (
    <Screen
      header={
        <Header title={provider ? 'Provider profile' : 'Become a provider'} subtitle={`Step ${step + 1} of ${STEPS.length}`}>
          <View style={{ paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.md }}>
            <StepIndicator steps={STEPS} current={step} />
          </View>
        </Header>
      }
      footer={footer}
      scrollRef={scrollRef}
      gap={t.spacing.xl}
    >
      <InlineAlert message={error} />

      {step === 0 ? (
        <Animated.View key="s0" entering={FadeInRight.duration(260)} style={{ gap: t.spacing.lg }}>
          <View style={{ gap: 4 }}>
            <Text variant="title2">Tell customers about you</Text>
            <Text variant="callout" color="muted">
              Customers see this on your public profile.
            </Text>
          </View>
          <Input label="Full name" value={fullName} onChangeText={setFullName} leftIcon="person-outline" autoComplete="name" />
          <TextArea
            label="Short bio"
            placeholder="e.g. AC technician with 6 years of experience. Daikin & Voltas trained."
            value={bio}
            onChangeText={setBio}
            maxLength={500}
          />
          <Input label="City" value={city} onChangeText={setCity} leftIcon="business-outline" />
          <View style={{ flexDirection: 'row', gap: t.spacing.lg }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text variant="captionStrong" color="textSecondary">
                Service radius (km)
              </Text>
              <Stepper value={radiusKm} min={1} max={100} step={1} onChange={setRadiusKm} label="Service radius" />
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text variant="captionStrong" color="textSecondary">
                Years of experience
              </Text>
              <Stepper value={years} min={0} max={60} onChange={setYears} label="Years of experience" />
            </View>
          </View>
          <View style={{ gap: t.spacing.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              Languages you speak
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
              {LANGUAGES.map((l) => (
                <Chip
                  key={l}
                  label={l}
                  selected={languages.includes(l)}
                  onPress={() => setLanguages((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]))}
                />
              ))}
            </View>
          </View>
          <Card variant="outlined" style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
            <Ionicons name={location.coords ? 'location' : 'location-outline'} size={22} color={location.coords ? t.colors.success : t.colors.muted} />
            <View style={{ flex: 1 }}>
              <Text variant="subhead">Base location</Text>
              <Text variant="caption" color="muted">
                {location.coords ? `Set · ${location.area ?? location.city ?? 'current position'}` : 'Used to match you with nearby customers'}
              </Text>
            </View>
            <Button title={location.coords ? 'Update' : 'Set'} size="sm" variant="secondary" onPress={() => void location.refresh()} loading={location.loading} />
          </Card>
        </Animated.View>
      ) : null}

      {step === 1 ? (
        <Animated.View key="s1" entering={FadeInRight.duration(260)} style={{ gap: t.spacing.lg }}>
          <View style={{ gap: 4 }}>
            <Text variant="title2">Your skills & fees</Text>
            <Text variant="callout" color="muted">
              Add each service you offer with your skill level, visit fee and labour rate.
            </Text>
          </View>
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              onDelete={async () => {
                const ok = await confirm({ title: `Remove ${s.categories?.name}?`, message: 'Customers will no longer find you for this service.', confirmLabel: 'Remove', destructive: true });
                if (!ok) return;
                await deleteService(s.id).catch((e: Error) => setError(e.message));
                setServices(await listMyServices());
              }}
              onAddRate={async (title, price) => {
                await addRateCardItem(s.id, title, price).catch((e: Error) => setError(e.message));
                setServices(await listMyServices());
              }}
            />
          ))}
          <Card gap={t.spacing.lg} elevation="md">
            <Text variant="title3">{services.length ? 'Add another skill' : 'Add your first skill'}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
              {categories.map((c) => {
                const selected = categoryId === c.id;
                const taken = services.some((s) => s.category_id === c.id);
                return (
                  <Chip
                    key={c.id}
                    label={c.name}
                    selected={selected}
                    icon={taken ? 'checkmark-circle' : undefined}
                    onPress={() => setCategoryId(c.id)}
                  />
                );
              })}
            </ScrollView>
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="captionStrong" color="textSecondary">
                Skill level
              </Text>
              <SegmentedControl<SkillLevel>
                options={LEVELS.map((l) => ({ value: l, label: skillLabel[l] }))}
                value={level}
                onChange={setLevel}
                accessibilityLabel="Skill level"
              />
            </View>
            <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <Input
                label="Visit fee"
                prefix="₹"
                keyboardType="number-pad"
                value={visitFee}
                onChangeText={(v) => setVisitFee(v.replace(/[^\d.]/g, ''))}
                helper="Typical ₹99–₹299"
                containerStyle={{ flex: 1 }}
              />
              <Input
                label="Labour rate"
                prefix="₹"
                keyboardType="number-pad"
                value={labourRate}
                onChangeText={(v) => setLabourRate(v.replace(/[^\d.]/g, ''))}
                placeholder="300"
                containerStyle={{ flex: 1 }}
              />
            </View>
            <SegmentedControl<RateUnit>
              options={[
                { value: 'job', label: 'Per job' },
                { value: 'hour', label: 'Per hour' },
              ]}
              value={rateUnit}
              onChange={setRateUnit}
              accessibilityLabel="Labour rate unit"
            />
            <Button title="Save skill" leftIcon="add-circle" onPress={() => void addService()} loading={saving} variant="secondary" />
          </Card>
        </Animated.View>
      ) : null}

      {step === 2 ? (
        <Animated.View key="s2" entering={FadeInRight.duration(260)} style={{ gap: t.spacing.lg }}>
          <View style={{ gap: 4 }}>
            <Text variant="title2">Payouts & verification</Text>
            <Text variant="callout" color="muted">
              You're verified once your payout account is activated with our payment partner.
            </Text>
          </View>
          <Card gap={t.spacing.md}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="title3">Verification status</Text>
              <Badge
                label={provider?.kyc_status === 'verified' ? 'Verified' : provider?.kyc_status === 'rejected' ? 'Rejected' : 'Pending'}
                tone={provider?.kyc_status === 'verified' ? 'success' : provider?.kyc_status === 'rejected' ? 'danger' : 'warning'}
                dot
                size="md"
              />
            </View>
            {[
              ['PAN card', 'For tax (TDS/TCS) compliance'],
              ['Bank account or UPI', 'Where your payouts are sent'],
              ['Aadhaar e-KYC', 'Done securely by the payment partner'],
            ].map(([title, sub]) => (
              <View key={title} style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
                <Ionicons
                  name={provider?.kyc_status === 'verified' ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={provider?.kyc_status === 'verified' ? t.colors.success : t.colors.borderStrong}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="subhead">{title}</Text>
                  <Text variant="caption" color="muted">
                    {sub}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
          <Card variant="tinted" tint={t.colors.successSoft} gap={t.spacing.sm}>
            <Text variant="title3" color="successText">
              Simple, fair commission
            </Text>
            {[
              ['First 30 days', '0%'],
              ['Standard', '12% of labour'],
              ['After 50 jobs', '10% of labour'],
              ['After 200 jobs', '8% of labour'],
            ].map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="callout" color="textSecondary">
                  {k}
                </Text>
                <Text variant="subhead">{v}</Text>
              </View>
            ))}
            <Text variant="caption" color="muted">
              Parts are always passed through at 0%. 18% GST applies on commission only.
            </Text>
          </Card>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

function ServiceCard(props: { service: ProviderService; onDelete: () => void; onAddRate: (title: string, price: number) => void }) {
  const t = useTheme();
  const { service: s } = props;
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [adding, setAdding] = useState(false);
  return (
    <Card gap={t.spacing.md}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
        <CategoryIcon icon={iconForSlug(s.categories?.slug)} size={44} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text variant="title3">{s.categories?.name}</Text>
          <SkillBadge level={s.skill_level} />
        </View>
        <IconButton icon="trash-outline" color="danger" size={20} accessibilityLabel={`Remove ${s.categories?.name}`} onPress={props.onDelete} />
      </View>
      <Text variant="callout" color="textSecondary">
        Visit {formatINR(s.visit_fee)} · Labour {formatINR(s.labour_rate)}/{s.rate_unit}
      </Text>
      {(s.rate_card_items ?? []).map((r) => (
        <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="callout">{r.title}</Text>
          <Text variant="subhead" tabular>
            {formatINR(r.price)}
          </Text>
        </View>
      ))}
      {adding ? (
        <View style={{ gap: t.spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
            <Input placeholder="e.g. Gas refill" value={title} onChangeText={setTitle} containerStyle={{ flex: 2 }} accessibilityLabel="Rate card item" />
            <Input prefix="₹" keyboardType="number-pad" value={price} onChangeText={(v) => setPrice(v.replace(/[^\d.]/g, ''))} containerStyle={{ flex: 1 }} accessibilityLabel="Price" />
          </View>
          <Button
            title="Add to rate card"
            size="sm"
            disabled={!title.trim() || !(Number(price) > 0)}
            onPress={() => {
              props.onAddRate(title.trim(), rupeesToPaise(Number(price)));
              setTitle('');
              setPrice('');
              setAdding(false);
            }}
          />
        </View>
      ) : (
        <Button title="Add rate card item" size="sm" variant="ghost" leftIcon="add" onPress={() => setAdding(true)} style={{ alignSelf: 'flex-start' }} />
      )}
    </Card>
  );
}
