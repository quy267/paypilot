import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import type { TooltipValueType } from "recharts";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { ACTION_LABEL, STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Stats } from "@/services/stats";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

const countSchema = z.number().int().nonnegative();
const ratioSchema = z.number().min(0).max(1).nullable();
const statsSchema = z.object({
  totalTransactions: countSchema,
  open: z.object({
    total: countSchema,
    byStatus: z.object({
      FAILED: countSchema,
      FLAGGED: countSchema,
      PENDING: countSchema
    })
  }),
  slaBreaches: countSchema,
  proposals: z.object({
    total: countSchema,
    byAction: z.object({
      RETRY: countSchema,
      ESCALATE: countSchema,
      REFUND: countSchema
    }),
    avgConfidence: ratioSchema
  }),
  decisions: z.object({
    approved: countSchema,
    rejected: countSchema,
    pending: countSchema,
    approvalRate: ratioSchema
  })
});

type OpenStatus = keyof Stats["open"]["byStatus"];
type ProposalAction = keyof Stats["proposals"]["byAction"];

interface ChartItem {
  key: string;
  label: string;
  value: number;
  color: string;
  dotClassName: string;
}

interface DashboardChartProps {
  id: string;
  title: string;
  description: string;
  data?: ChartItem[];
}

const countFormatter = new Intl.NumberFormat("vi-VN");
const percentFormatter = new Intl.NumberFormat("vi-VN", {
  style: "percent",
  maximumFractionDigits: 1
});

function formatPercent(value: number | null): string {
  return value === null ? "—" : percentFormatter.format(value);
}

function DashboardChart({ id, title, description, data }: DashboardChartProps) {
  const chartData = data ?? [];
  const hasData = chartData.some((item) => item.value > 0);

  return (
    <Card className="min-w-0 shadow-card" aria-labelledby={id}>
      <CardHeader>
        <CardTitle>
          <h2 id={id}>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <figure>
            <div className="h-64 min-w-0 sm:h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                  accessibilityLayer
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    width={42}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                    contentStyle={{
                      backgroundColor: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      color: "var(--popover-foreground)"
                    }}
                    formatter={(value: TooltipValueType | undefined) => [
                      countFormatter.format(Number(value)),
                      "Số lượng"
                    ]}
                  />
                  <Bar dataKey="value" maxBarSize={56} radius={[6, 6, 0, 0]}>
                    {chartData.map((item) => (
                      <Cell key={item.key} fill={item.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <figcaption className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              {chartData.map((item) => (
                <span key={item.key} className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("size-2 rounded-full", item.dotClassName)}
                  />
                  {item.label}: {countFormatter.format(item.value)}
                </span>
              ))}
            </figcaption>
          </figure>
        ) : (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground sm:h-72">
            Chưa có dữ liệu
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/stats", { signal });
      if (!response.ok) {
        throw new Error(`Stats request failed (${response.status})`);
      }
      const parsed = statsSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("Stats response has an invalid shape");
      }
      setStats(parsed.data);
    } catch (loadError) {
      if (signal?.aborted) return;
      console.error("Failed to load dashboard stats:", loadError);
      setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadStats(controller.signal);
    return () => controller.abort();
  }, [loadStats]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <output className="text-sm text-muted-foreground" aria-live="polite">
          Đang tải dữ liệu tổng quan…
        </output>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card className="w-full max-w-md text-center shadow-card" role="alert">
          <CardHeader>
            <CardTitle>Không thể tải dữ liệu tổng quan</CardTitle>
            <CardDescription>Vui lòng thử lại sau giây lát.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => loadStats()}>
              Thử lại
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const kpis = [
    {
      label: "Cần xử lý",
      value: countFormatter.format(stats.open.total),
      description: `${countFormatter.format(stats.totalTransactions)} giao dịch tổng cộng`,
      dotClassName: "dot-blue"
    },
    {
      label: "Quá hạn SLA",
      value: countFormatter.format(stats.slaBreaches),
      description: "Giao dịch mở cần ưu tiên",
      dotClassName: "dot-red"
    },
    {
      label: "Tỉ lệ duyệt",
      value: formatPercent(stats.decisions.approvalRate),
      description: "Trên các đề xuất đã quyết định",
      dotClassName: "dot-green"
    },
    {
      label: "Độ tự tin TB",
      value: formatPercent(stats.proposals.avgConfidence),
      description: `${countFormatter.format(stats.proposals.total)} đề xuất của AI`,
      dotClassName: "dot-amber"
    }
  ];

  const openStatusConfig: Array<{
    status: OpenStatus;
    color: string;
    dotClassName: string;
  }> = [
    { status: "FAILED", color: "var(--t-red-dot)", dotClassName: "dot-red" },
    {
      status: "FLAGGED",
      color: "var(--t-amber-dot)",
      dotClassName: "dot-amber"
    },
    {
      status: "PENDING",
      color: "var(--t-blue-dot)",
      dotClassName: "dot-blue"
    }
  ];
  const openData = openStatusConfig.map(({ status, color, dotClassName }) => ({
    key: status,
    label: STATUS_LABEL[status],
    value: stats.open.byStatus[status],
    color,
    dotClassName
  }));

  const actionConfig: Array<{
    action: ProposalAction;
    color: string;
    dotClassName: string;
  }> = [
    { action: "RETRY", color: "var(--t-blue-dot)", dotClassName: "dot-blue" },
    {
      action: "ESCALATE",
      color: "var(--t-amber-dot)",
      dotClassName: "dot-amber"
    },
    {
      action: "REFUND",
      color: "var(--t-green-dot)",
      dotClassName: "dot-green"
    }
  ];
  const proposalData = actionConfig.map(({ action, color, dotClassName }) => ({
    key: action,
    label: ACTION_LABEL[action],
    value: stats.proposals.byAction[action],
    color,
    dotClassName
  }));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
        <section
          aria-label="Chỉ số tổng quan"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        >
          {kpis.map((kpi) => (
            <Card key={kpi.label} className="gap-4 shadow-card">
              <CardHeader className="gap-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn("size-2 rounded-full", kpi.dotClassName)}
                  />
                  {kpi.label}
                </CardTitle>
                <div className="text-3xl font-semibold tracking-tight tabular-nums">
                  {kpi.value}
                </div>
                <CardDescription>{kpi.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </section>

        <section
          aria-label="Biểu đồ tổng quan"
          className="grid grid-cols-1 gap-4 xl:grid-cols-2"
        >
          <DashboardChart
            id="open-status-chart-title"
            title="Giao dịch mở theo trạng thái"
            description="Phân bổ các giao dịch đang cần xử lý"
            data={openData}
          />
          <DashboardChart
            id="proposal-action-chart-title"
            title="Đề xuất của AI"
            description="Phân bổ hành động AI đã đề xuất"
            data={proposalData}
          />
        </section>
      </div>
    </div>
  );
}
