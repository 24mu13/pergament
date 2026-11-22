import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { SectionTitle, useApp } from "@/app";
import { api, chapterTarget, type DaySpan, type PlanSchedule, type ReadingPlanState } from "@/lib/api";
import { bibleFor } from "@/lib/bible";
import { isoDate } from "@/lib/dates";
import { locale, t } from "@/lib/i18n";
import { isCalendarDate, knownPlans, passageLabel, planStatus, planTitle, readBefore, type PlanStatus } from "@/lib/reading-plans";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Plan = ReturnType<typeof knownPlans>[number];

/** Catalog + states, reloaded on mount, on `userVersion` and after every write it performs. */
export function useReadingPlans() {
  const { toast, userVersion } = useApp();
  const [catalog, setCatalog] = useState<PlanSchedule[]>([]);
  const [states, setStates] = useState<ReadingPlanState[]>([]);

  const load = useCallback(
    () =>
      Promise.all([api.readingPlanCatalog(), api.readingPlans()])
        .then(([c, s]) => {
          setCatalog(c);
          setStates(s);
        })
        .catch((e) => toast(String(e))),
    [toast],
  );

  useEffect(() => {
    void load();
  }, [load, userVersion]);

  const write = useCallback(
    async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (e) {
        toast(String(e));
      }
      await load();
    },
    [load, toast],
  );

  return {
    plans: knownPlans(states, catalog),
    // Known plans whose start date can't be read (only from a foreign or hand-edited database): shown so they can be deleted.
    broken: states.filter((s) => planTitle(s.planKey) !== null && !isCalendarDate(s.startDate)),
    catalog,
    setDay: (guid: string, day: number, done: boolean) => write(() => api.setReadingDay(guid, day, done)),
    start: (key: string, date: string, before: number | null) => write(() => api.startReadingPlan(key, date, before)),
    remove: (guid: string) => write(() => api.deleteReadingPlan(guid)),
  };
}

/** Renders the passage as a button that opens its first chapter in bibleFor(null, publications, lang, bibles), or as plain text when there is none. */
export function Passage({ span }: { span: DaySpan }) {
  const { publications, lang, bibles, openTarget } = useApp();
  const bible = bibleFor(null, publications, lang, bibles);
  const label = passageLabel(span);
  if (!bible) return <span>{label}</span>;
  return (
    <button
      onClick={() => openTarget(chapterTarget(bible.dir, span.startBook, span.startChapter))}
      className="rounded-md text-left hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {label}
    </button>
  );
}

export function ReadingPlansSection() {
  const { publications, lang, bibles, push } = useApp();
  const { plans, broken, catalog, setDay, start, remove } = useReadingPlans();
  const [starting, setStarting] = useState(false);
  const running = new Set([...plans.map((p) => p.state.planKey), ...broken.map((b) => b.planKey)]);
  const available = catalog.filter((s) => planTitle(s.key) !== null && !running.has(s.key));
  const noBible = !bibleFor(null, publications, lang, bibles);

  // A reload can make the last offered plan run (e.g. started on another device): close the dialog then.
  useEffect(() => {
    if (available.length === 0) setStarting(false);
  }, [available.length]);

  return (
    <>
      <SectionTitle>Reading plans</SectionTitle>
      {plans.length === 0 && broken.length === 0 && <p className="mb-3 text-sm text-muted">{t("No reading plan yet")}</p>}
      {plans.length > 0 && noBible && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
          {t("Download a Bible to open passages.")}
          <button
            onClick={() => push({ name: "library", tab: "publications" })}
            className="rounded-md border border-line bg-surface px-2.5 py-1 text-fg hover:bg-bar"
          >
            {t("Library")}
          </button>
        </p>
      )}
      <div className="flex flex-col gap-2">
        {plans.map((p) => (
          <PlanCard
            key={p.state.guid}
            plan={p}
            onDay={(day, done) => void setDay(p.state.guid, day, done)}
            onDelete={() => void remove(p.state.guid)}
          />
        ))}
        {broken.map((b) => (
          <div key={b.guid} className="flex items-start gap-3 rounded-md border border-line p-3">
            <BookOpen size={18} className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{planTitle(b.planKey)}</div>
              <div className="text-[13px] text-muted">{t("The start date of this plan can't be read.")}</div>
            </div>
            <DeletePlan onDelete={() => void remove(b.guid)} />
          </div>
        ))}
      </div>
      {available.length > 0 && (
        <button
          onClick={() => setStarting(true)}
          className="mt-3 flex items-center gap-2 rounded-md border border-line bg-surface px-4 py-2 text-sm hover:bg-bar"
        >
          <Plus size={17} /> {t("Start a plan")}
        </button>
      )}
      {starting && available.length > 0 && <StartDialog plans={available} onStart={start} onClose={() => setStarting(false)} />}
    </>
  );
}

function StartDialog({
  plans,
  onStart,
  onClose,
}: {
  plans: PlanSchedule[];
  onStart: (key: string, date: string, readBefore: number | null) => Promise<void>;
  onClose: () => void;
}) {
  const today = isoDate(new Date());
  const [picked, setKey] = useState(plans[0].key);
  // The picked plan may drop out of `plans` after a reload; fall back to the first one left.
  const key = plans.some((p) => p.key === picked) ? picked : plans[0].key;
  const [date, setDate] = useState(today);
  const [read, setRead] = useState(true);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const total = plans.find((p) => p.key === key)?.days.length ?? 0;
  const before = date ? readBefore(date, today, total) : null;

  const submit = async () => {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    await onStart(key, date, read ? before : null);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{t("Start a reading plan")}</DialogTitle>
        <Select value={key} onValueChange={setKey}>
          <SelectTrigger aria-label={t("Plan")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {plans.map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {planTitle(p.key)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex flex-col gap-1 text-sm">
          {t("Start date")}
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {before !== null && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} className="size-4 accent-accent" />
            {t("I've already read the days before today")}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button size="sm" disabled={!date || busy} onClick={() => void submit()}>
            {t("Start")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function statusText(status: PlanStatus): string | null {
  switch (status.kind) {
    case "running":
      if (status.behind === 0) return null;
      return status.behind === 1 ? t("1 day behind") : t("{n} days behind", { n: status.behind });
    case "ended":
      return t("Schedule ended · {n} days left", { n: status.left });
    case "finished":
      return t("Finished");
    case "upcoming":
      return null;
  }
}

/** A YYYY-MM-DD date in the interface locale, e.g. "March 4, 2026". */
const dayLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" });

/** The day to read now: today's, the first unread one after the schedule ended, day 1 ahead of the start, none when finished. */
export function readingDay(status: PlanStatus): number | null {
  switch (status.kind) {
    case "running":
      return status.day;
    case "ended":
      return status.firstOpen;
    case "upcoming":
      return 1;
    case "finished":
      return null;
  }
}

/** Home card: one line per plan with the passage to read now. Renders nothing without a plan. */
export function TodayReadingCard() {
  const { plans, setDay } = useReadingPlans();
  if (plans.length === 0) return null;
  const today = isoDate(new Date());
  return (
    <section>
      <SectionTitle variant="quiet">Today's reading</SectionTitle>
      <ul className="border-t border-line">
        {plans.map(({ state, schedule }) => {
          const status = planStatus(state, schedule.days.length, today);
          const day = readingDay(status);
          const span = schedule.days.find((s) => s.day === day);
          const tickable = status.kind === "running" || status.kind === "ended";
          const note = status.kind === "upcoming" ? t("Starts on {date}", { date: dayLabel(status.startsOn) }) : statusText(status);
          return (
            <li key={state.guid} className="flex items-center gap-3 border-b border-line px-1 py-2 text-sm">
              {span && tickable ? (
                <input
                  type="checkbox"
                  aria-label={t("Day {n}", { n: span.day })}
                  checked={state.done.includes(span.day)}
                  onChange={(e) => void setDay(state.guid, span.day, e.target.checked)}
                  className="size-4 shrink-0 accent-accent"
                />
              ) : (
                <BookOpen size={16} className="shrink-0 text-accent" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate">{planTitle(state.planKey) ?? state.planKey}</div>
                {span && (
                  <div className="text-[13px]">
                    <Passage span={span} />
                  </div>
                )}
              </div>
              {note && <span className="shrink-0 text-[13px] text-muted">{note}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The delete button with its confirmation. */
function DeletePlan({ onDelete }: { onDelete: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        aria-label={t("Delete reading plan")}
        title={t("Delete reading plan")}
        className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bar hover:text-fg"
      >
        <Trash2 size={16} />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle className="sr-only">{t("Delete reading plan")}</AlertDialogTitle>
        <AlertDialogDescription>{t("Delete this reading plan? Your progress in it is lost.")}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete}>{t("Delete")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PlanCard({ plan, onDay, onDelete }: { plan: Plan; onDay: (day: number, done: boolean) => void; onDelete: () => void }) {
  const { state, schedule } = plan;
  const [open, setOpen] = useState(false);
  const current = useRef<HTMLLIElement>(null);
  const total = schedule.days.length;
  const status = planStatus(state, total, isoDate(new Date()));
  const done = new Set(state.done.filter((d) => d >= 1 && d <= total));
  const title = planTitle(state.planKey) ?? state.planKey;
  const started =
    status.kind === "upcoming"
      ? t("Starts on {date}", { date: dayLabel(state.startDate) })
      : t("Started {date}", { date: dayLabel(state.startDate) });
  const today = status.kind === "running" ? status.day : null;
  // After the schedule ended there is no today; the first unread day is where to pick up.
  const focusDay = today ?? (status.kind === "ended" ? status.firstOpen : null);
  const note = statusText(status);

  useEffect(() => {
    if (open) current.current?.scrollIntoView({ block: "center" });
  }, [open]);

  return (
    <div className="rounded-md border border-line p-3">
      <div className="flex items-start gap-3">
        <BookOpen size={18} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-[13px] text-muted">{started}</div>
        </div>
        <button
          aria-label={open ? t("Hide days") : t("Show days")}
          title={open ? t("Hide days") : t("Show days")}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bar hover:text-fg"
        >
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        <DeletePlan onDelete={onDelete} />
      </div>
      <Progress value={(done.size / total) * 100} label={title} className="mt-3" />
      <div className="mt-1.5 flex justify-between gap-3 text-[13px] text-muted">
        <span>{`${done.size} / ${total}`}</span>
        {note && <span>{note}</span>}
      </div>
      {open && (
        <ul className="mt-3 max-h-80 overflow-y-auto border-t border-line pt-2">
          {schedule.days.map((span) => (
            <li
              key={span.day}
              ref={span.day === focusDay ? current : undefined}
              className={cn("flex items-center gap-3 rounded-md px-1 py-1 text-sm", span.day === today && "bg-bar")}
            >
              <label className="flex w-24 shrink-0 items-center gap-2 text-muted">
                <input
                  type="checkbox"
                  checked={done.has(span.day)}
                  onChange={(e) => onDay(span.day, e.target.checked)}
                  className="size-4 accent-accent"
                />
                {t("Day {n}", { n: span.day })}
              </label>
              <span className="min-w-0 flex-1">
                <Passage span={span} />
              </span>
              {span.day === today && <span className="text-[13px] text-accent">{t("today")}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
