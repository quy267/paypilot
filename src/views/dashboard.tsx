import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export function DashboardView() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <CardTitle>Tổng quan — đang xây dựng</CardTitle>
        </CardHeader>
      </Card>
    </div>
  );
}
