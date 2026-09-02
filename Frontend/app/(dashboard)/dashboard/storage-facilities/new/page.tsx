"use client"

import React, { useEffect, useMemo, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { StorageFacilityFormUI } from '@/components/dashboard/storage-facility-form';
import { CustomAttributes } from '@/components/dashboard/custom-attributes';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { useDataStore } from '@/store/data-store';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';

const formSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  material: z.string().optional(),
  capacity: z.coerce.number().optional(),
  depth_m: z.coerce.number().optional(),
  elevation_m: z.coerce.number().optional(),
  inner_diameter_m: z.coerce.number().optional(),
  outer_diameter_m: z.coerce.number().optional(),
  tank_shape: z.string().optional(),
  status: z.string().optional(),
  condition: z.string().optional(),
  location: z.string().optional(),
  zone_location: z.string().optional(),
  asset_id: z.string().optional(),
  installer: z.string().optional(),
  service_area: z.string().optional(),
  custom_attributes: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  register_sensor: z.boolean().default(false),
  sensor_device_id: z.string().optional(),
  sensor_h1_m: z.coerce.number().optional(),
  sensor_depth_m: z.coerce.number().optional(),
  sensor_activated: z.boolean().default(false),
}).refine(data => {
  if (data.register_sensor && !data.sensor_device_id) {
    return false;
  }
  return true;
}, {
  message: "Sensor Device ID is required when registering a sensor",
  path: ["sensor_device_id"],
});

export default function StorageFacilityCreatePage() {
  const router = useRouter();
  const { currentUser } = useAuthStore();
  const { utilities, dmas, fetchUtilities, fetchDMAs } = useDataStore();
  const [utilityId, setUtilityId] = useState<string>("");
  const [dmaId, setDmaId] = useState<string>("");

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      latitude: null as unknown as number,
      longitude: null as unknown as number,
      custom_attributes: [],
      register_sensor: false,
      sensor_device_id: '',
      sensor_activated: false,
    },
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void fetchUtilities();
    void fetchDMAs();
  }, [fetchUtilities, fetchDMAs]);

  // Auto-select utility for utility_manager
  useEffect(() => {
    if (currentUser?.role === "utility_manager" && currentUser?.utilityId) {
      setUtilityId(currentUser.utilityId);
    }
  }, [currentUser]);

  // Auto-select DMA for dma_manager
  useEffect(() => {
    if (currentUser?.role === "dma_manager" && currentUser?.dmaId) {
      setDmaId(currentUser.dmaId);
      // Also set the utility from the DMA
      const dma = dmas.find(d => d.id === currentUser.dmaId);
      if (dma?.utilityId) {
        setUtilityId(dma.utilityId);
      }
    }
  }, [currentUser, dmas]);

  const selectedUtility = useMemo(() => utilities.find(u => u.id === utilityId) || null, [utilities, utilityId]);
  const selectedDMA = useMemo(() => dmas.find(d => d.id === dmaId) || null, [dmas, dmaId]);

  async function onSubmit(values: any) {
    setIsSubmitting(true);
    if (!utilityId) {
      toast.error('Please select a utility');
      setIsSubmitting(false);
      return;
    }
    if (!values.latitude || !values.longitude) {
      toast.error('Tank location (latitude and longitude) is required');
      setIsSubmitting(false);
      return;
    }
    try {
      // Convert custom_attributes array to object for API
      const formattedAttributes = values.custom_attributes?.reduce((acc: any, curr: any) => {
        if (curr.key) acc[curr.key] = curr.value;
        return acc;
      }, {}) || {};

      const payload = {
        ...values,
        custom_attributes: formattedAttributes,
      };

      // Call backend API
      const response = await apiClient.post<{ success: boolean; data: any }>(
        `/api/utilities/${utilityId}/storage-facilities/manual`,
        payload
      );

      if (!response.success) {
        throw new Error(response.error || 'Failed to create storage facility');
      }

      toast.success('Storage facility created successfully');
      
      // Navigate to the new tank's detail page or water-level page
      if (response.data?.tank?.id) {
        router.push(`/dashboard/sensor-data/${response.data.tank.id}`);
      } else {
        router.push('/dashboard/sensor-data');
        router.refresh();
      }
    } catch (error: any) {
      toast.error(error.message || 'An error occurred while creating the facility');
    } finally {
      setIsSubmitting(false);
    }
  }

  const onReset = () => {
    form.reset();
  };

  if (!utilityId && currentUser?.role !== "admin") {
    return (
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => router.back()}
            className="rounded-full"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Add Storage Facility</h1>
            <p className="text-sm text-slate-500">
              Register a new tank and optionally link a sensor.
            </p>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="text-amber-800">Please select a utility first or contact your administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => router.back()}
            className="rounded-full"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Add Storage Facility</h1>
            <p className="text-sm text-slate-500">
              Register a new tank and optionally link a sensor.
            </p>
          </div>
        </div>
        {currentUser?.role === "admin" && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">Utility:</label>
            <select
              value={utilityId}
              onChange={(e) => setUtilityId(e.target.value)}
              className="h-10 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 text-sm font-medium shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-cyan-400/20"
            >
              <option value="">Select Utility</option>
              {utilities.map((utility) => (
                <option key={utility.id} value={utility.id}>
                  {utility.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {utilityId && (
        <FormProvider {...form}>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <StorageFacilityFormUI 
                form={form}
                isSubmitting={isSubmitting}
                utilityCenter={selectedUtility ? { latitude: selectedUtility.centerLatitude, longitude: selectedUtility.centerLongitude } : null}
                dmaCenter={selectedDMA ? { latitude: selectedDMA.centerLatitude, longitude: selectedDMA.centerLongitude } : null}
                userRole={currentUser?.role}
                onSubmit={onSubmit}
                onReset={onReset}
              />
            </div>
            <div className="space-y-6">
              <CustomAttributes />
              <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6 h-fit">
                <h3 className="font-semibold text-slate-800 mb-4">Instructions</h3>
                <ul className="space-y-4 text-sm text-slate-600">
                  <li className="flex gap-3">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold">1</div>
                    <p>Enter the tank name and other physical attributes.</p>
                  </li>
                  <li className="flex gap-3">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold">2</div>
                    <p>Pin the tank location on the map or type coordinates manually.</p>
                  </li>
                  <li className="flex gap-3">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold">3</div>
                    <p>Optionally register a sensor device to start monitoring.</p>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </FormProvider>
      )}
    </div>
  );
}
