import { useState, useEffect } from "react";
import { Shield, Search, Loader2, CheckCircle2, AlertCircle, Building2, FileText, Calendar } from "lucide-react";
import { Shield, Search, Loader2, CheckCircle2, AlertCircle, Building2, FileText, Calendar, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
const YEARS = Array.from({ length: 5 }, (_, i) => String(currentYear - i));
const ResultCard = ({ result, title }: { result: any; title: string }) => (
  <Card className="border-primary/30 bg-primary/[0.02]">
    <CardHeader className="pb-3">
      <div className="flex items-center gap-2">
        {result.status === "success" ? (
          <CheckCircle2 className="h-5 w-5 text-green-600" />
        ) : (
          <AlertCircle className="h-5 w-5 text-amber-500" />
        )}
        <CardTitle className="text-lg font-[Space_Grotesk]">{title}</CardTitle>
      </div>
      <CardDescription>{result.message}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Empresa</p>
          <p className="text-sm font-medium text-foreground">{result.company?.razao_social}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">CNPJ</p>
          <p className="text-sm font-medium text-foreground">{result.company?.cnpj}</p>
const NotFoundCard = ({ result, title }: { result: any; title: string }) => (
  <Card className="border-amber-300 bg-amber-50/50">
    <CardContent className="pt-6 pb-4">
      <div className="flex items-start gap-3">
        <Info className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
        <div>
          <h3 className="font-semibold text-amber-800 font-[Space_Grotesk]">{title}</h3>
          <p className="text-sm text-amber-700 mt-1">{result.message}</p>
        </div>
      </div>
      {result.status === "mtls_required" && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-800">mTLS necessário</p>
          </div>
          <p className="text-sm text-amber-700">{result.message}</p>
        </div>
      )}
      {result.data && (
        <div className="p-4 rounded-lg bg-muted/50 border border-border overflow-auto">
          <pre className="text-xs text-foreground whitespace-pre-wrap">
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      )}
    </CardContent>
  </Card>
);
const ResultCard = ({ result, title }: { result: any; title: string }) => {
  if (result.status === "not_found") {
    return <NotFoundCard result={result} title={title} />;
  }
  return (
    <Card className="border-primary/30 bg-primary/[0.02]">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          {result.status === "success" ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : (
            <AlertCircle className="h-5 w-5 text-amber-500" />
          )}
          <CardTitle className="text-lg font-[Space_Grotesk]">{title}</CardTitle>
        </div>
        <CardDescription>{result.message}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Empresa</p>
            <p className="text-sm font-medium text-foreground">{result.company?.razao_social}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">CNPJ</p>
            <p className="text-sm font-medium text-foreground">{result.company?.cnpj}</p>
          </div>
        </div>
        {result.status === "mtls_required" && (
          <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-medium text-amber-800">mTLS necessário</p>
            </div>
            <p className="text-sm text-amber-700">{result.message}</p>
          </div>
        )}
        {result.data && (
          <div className="p-4 rounded-lg bg-muted/50 border border-border overflow-auto">
            <pre className="text-xs text-foreground whitespace-pre-wrap">
              {JSON.stringify(result.data, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
const EcacPage = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
      if (!response.ok) {
        // 404 = data not found, show inline instead of error toast
        if (response.status === 404 || data.not_found) {
          setResult({ status: "not_found", message: data.error || "Dados não encontrados.", data: null });
          toast.info("Nenhum dado encontrado para esta consulta.");
          return;
        }
        throw new Error(data.error || "Erro ao consultar SERPRO");
      }
