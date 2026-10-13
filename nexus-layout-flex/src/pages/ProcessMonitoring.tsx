import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { Activity, RefreshCw, CheckCircle2, XCircle, ShieldAlert, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

import { PRODUCTION_URL } from "@/utils/Api";

interface JobStat {
  jobName: string;
  label: string;
  meanDurationMs: number | null;
  totalRuns: number;
  lastRunAt: string | null;
  lastRunStatus: "success" | "error" | null;
  lastRunWasFallback: boolean;
  lastRunError: string | null;
  fallbackCountToday: number;
  fallbackCountThisWeek: number;
  fallbackCountThisMonth: number;
}

const POLL_MS = 60000;

const formatDuration = (ms: number | null) => {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes}m ${seconds}s`;
  return `${hours}h ${minutes % 60}m`;
};

const formatRelativeTime = (iso: string | null) => {
  if (!iso) return "Never run";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export default function ProcessMonitoring() {
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<JobStat[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${PRODUCTION_URL}/process-monitoring`);
      setJobs(res.data.data || []);
      setGeneratedAt(res.data.generatedAt || null);
    } catch (error) {
      console.error("Error fetching process monitoring stats:", error);
      toast.error("Failed to fetch process monitoring stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    const interval = setInterval(fetchStats, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const fallbacksToday = jobs.reduce((sum, j) => sum + j.fallbackCountToday, 0);
  const fallbacksThisWeek = jobs.reduce((sum, j) => sum + j.fallbackCountThisWeek, 0);
  const fallbacksThisMonth = jobs.reduce((sum, j) => sum + j.fallbackCountThisMonth, 0);
  const jobsInErrorNow = jobs.filter((j) => j.lastRunStatus === "error").length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-400" />
            Process Monitoring
          </h1>
          <p className="text-muted-foreground mt-1">
            Mean run time per cron job, and how often each had to fall back to running without Redis lock protection.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={fetchStats} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Jobs Currently Erroring</p>
              <p className="text-2xl font-bold mt-1">{jobsInErrorNow}</p>
            </div>
            <div className="p-3 rounded-lg bg-red-500/10">
              <XCircle className="h-5 w-5 text-red-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Redis Fallbacks Today</p>
            <p className="text-2xl font-bold mt-1 text-amber-400">{fallbacksToday}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Redis Fallbacks This Week</p>
            <p className="text-2xl font-bold mt-1 text-amber-400">{fallbacksThisWeek}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Redis Fallbacks This Month</p>
            <p className="text-2xl font-bold mt-1 text-amber-400">{fallbacksThisMonth}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Cron Jobs</CardTitle>
          <CardDescription>
            Mean duration and total runs are over the last 30 days. "Redis fallback" means the job ran without lock
            protection because Redis was unreachable at that tick — see utils/cronLock.js.
            {generatedAt && (
              <span className="block mt-1 text-xs">Last updated {formatRelativeTime(generatedAt)}</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border/50 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead className="text-center">Mean Duration</TableHead>
                  <TableHead className="text-center">Total Runs (30d)</TableHead>
                  <TableHead className="text-center">Fallback Today</TableHead>
                  <TableHead className="text-center">Fallback This Week</TableHead>
                  <TableHead className="text-center">Fallback This Month</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {loading ? "Loading..." : "No cron run history yet"}
                    </TableCell>
                  </TableRow>
                ) : (
                  jobs.map((job) => (
                    <TableRow key={job.jobName}>
                      <TableCell>
                        <p className="font-medium">{job.label}</p>
                        <p className="text-xs text-muted-foreground font-mono">{job.jobName}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {job.lastRunStatus === "error" ? (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                              <XCircle className="h-3 w-3 mr-1" />
                              ERROR
                            </Badge>
                          ) : job.lastRunStatus === "success" ? (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              OK
                            </Badge>
                          ) : (
                            <Badge variant="outline">No runs yet</Badge>
                          )}
                          {job.lastRunWasFallback && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">
                              <ShieldAlert className="h-3 w-3 mr-1" />
                              Fallback
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(job.lastRunAt)}
                        </p>
                        {job.lastRunStatus === "error" && job.lastRunError && (
                          <p className="text-xs text-red-400/80 mt-1 max-w-xs truncate" title={job.lastRunError}>
                            {job.lastRunError}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">{formatDuration(job.meanDurationMs)}</TableCell>
                      <TableCell className="text-center">{job.totalRuns}</TableCell>
                      <TableCell className="text-center">
                        <span className={job.fallbackCountToday > 0 ? "text-amber-400 font-semibold" : "text-muted-foreground"}>
                          {job.fallbackCountToday}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={job.fallbackCountThisWeek > 0 ? "text-amber-400 font-semibold" : "text-muted-foreground"}>
                          {job.fallbackCountThisWeek}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className={job.fallbackCountThisMonth > 0 ? "text-amber-400 font-semibold" : "text-muted-foreground"}>
                          {job.fallbackCountThisMonth}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
