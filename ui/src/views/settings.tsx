import { useState } from "react";
import { AppBar } from "@/app";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/lib/i18n";
import { AboutTab } from "./settings/about";
import { DataTab } from "./settings/data";
import { InterfaceTab } from "./settings/interface";
import { ReadingTab } from "./settings/reading";

/** The last selected tab, kept for the session so the view reopens where it was left. */
let lastTab = "interface";

export function SettingsView() {
  const [tab, setTabState] = useState(lastTab);
  const setTab = (value: string) => {
    lastTab = value;
    setTabState(value);
  };
  const content = "page flex-1 overflow-y-auto pt-6 focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <>
      <AppBar title={t("Settings")} />
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <div className="page pb-0 pt-6">
          <TabsList>
            <TabsTrigger value="interface">{t("Interface")}</TabsTrigger>
            <TabsTrigger value="reading">{t("Reading")}</TabsTrigger>
            <TabsTrigger value="data">{t("Library & data")}</TabsTrigger>
            <TabsTrigger value="about">{t("About")}</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="interface" className={content}>
          <InterfaceTab />
        </TabsContent>
        <TabsContent value="reading" className={content}>
          <ReadingTab />
        </TabsContent>
        <TabsContent value="data" className={content}>
          <DataTab />
        </TabsContent>
        <TabsContent value="about" className={content}>
          <AboutTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
