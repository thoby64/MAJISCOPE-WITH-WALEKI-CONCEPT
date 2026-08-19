'use client'

import React, { useState } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { toast } from 'sonner'
import { Plus, Trash2, MapPin, Wifi, Info } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { MapPicker } from './map-picker'
import { CustomAttributes } from './custom-attributes'
import { apiClient } from '@/lib/api-client'

const formSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
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
})

interface StorageFacilityFormProps {
  utilityId: string
  utilityCenter?: { latitude: number | null; longitude: number | null } | null
  dmaCenter?: { latitude: number | null; longitude: number | null } | null
  userRole?: string
}

interface StorageFacilityFormUIProps {
  form: ReturnType<typeof useForm>
  isSubmitting: boolean
  utilityCenter?: { latitude: number | null; longitude: number | null } | null
  dmaCenter?: { latitude: number | null; longitude: number | null } | null
  userRole?: string
  onSubmit: (values: any) => Promise<void>
  onReset: () => void
}

export function StorageFacilityFormUI({ form, isSubmitting, utilityCenter, dmaCenter, userRole, onSubmit, onReset }: StorageFacilityFormUIProps) {
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        {/* Basic Information */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <Info className="h-5 w-5 text-sky-600" />
              <h3 className="text-lg font-semibold text-slate-800">Basic Information</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tank Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Tank A1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-end gap-2">
                <FormField
                  control={form.control}
                  name="latitude"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Latitude</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" {...field} value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? null : parseFloat(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                /><FormField
                  control={form.control}
                  name="longitude"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Longitude</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" {...field} value={field.value ?? ''} onChange={e => field.onChange(e.target.value === '' ? null : parseFloat(e.target.value))} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="h-80 w-full rounded-xl overflow-hidden border border-slate-200">
              <MapPicker 
                latitude={form.watch('latitude')} 
                longitude={form.watch('longitude')}
                onChange={(lat, lon) => {
                  form.setValue('latitude', lat);
                  form.setValue('longitude', lon);
                }}
                utilityCenter={utilityCenter}
                dmaCenter={dmaCenter}
                userRole={userRole}
              />
            </div>
          </CardContent>
        </Card>

        {/* Optional Attributes */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <Info className="h-5 w-5 text-sky-600" />
              <h3 className="text-lg font-semibold text-slate-800">Technical Specifications</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="material"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Material</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select material" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="BRICK">Brick</SelectItem>
                        <SelectItem value="CONCRETE">Concrete</SelectItem>
                        <SelectItem value="STEEL">Steel</SelectItem>
                        <SelectItem value="PLASTIC">Plastic</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="inner_diameter_m"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Inner Diameter (m)</FormLabel>
                    <FormControl>
                      <Input type="number" step="any" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="outer_diameter_m"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Outer Diameter (m)</FormLabel>
                    <FormControl>
                      <Input type="number" step="any" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="capacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacity (m³)</FormLabel>
                    <FormControl>
                      <Input type="number" step="any" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="depth_m"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Depth (m)</FormLabel>
                    <FormControl>
                      <Input type="number" step="any" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="elevation_m"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ground Elevation (m)</FormLabel>
                    <FormControl>
                      <Input type="number" step="any" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormField
                control={form.control}
                name="tank_shape"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tank Shape</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select shape" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="CYLINDRICAL">Cylindrical</SelectItem>
                        <SelectItem value="RECTANGULAR">Rectangular</SelectItem>
                        <SelectItem value="SPHERICAL">Spherical</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select status" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Active</SelectItem>
                        <SelectItem value="INACTIVE">Inactive</SelectItem>
                        <SelectItem value="MAINTENANCE">Maintenance</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Sensor Registration */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6 space-y-6">
            <div className="flex items-center gap-2 mb-4">
              <Wifi className="h-5 w-5 text-sky-600" />
              <h3 className="text-lg font-semibold text-slate-800">Sensor Registration (Optional)</h3>
            </div>

            <FormField
              control={form.control}
              name="register_sensor"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                  <div className="space-y-0.5">
                    <FormItem>
                      <FormLabel className="text-base">Register sensor now?</FormLabel>
                    </FormItem>
                    <FormDescription className="text-sm text-slate-500">
                      Link a water-level sensor to this tank immediately.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Checkbox 
                      checked={field.value} 
                      onCheckedChange={field.onChange} 
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {form.watch('register_sensor') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
                <FormField
                  control={form.control}
                  name="sensor_device_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Device ID</FormLabel>
                      <FormControl>
                        <Input placeholder="SENS-12345" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sensor_h1_m"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>H1 (m)</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sensor_depth_m"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Depth (m)</FormLabel>
                      <FormControl>
                        <Input type="number" step="any" {...field} onChange={e => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sensor_activated"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
                      <div className="space-y-0.5">
                        <FormItem>
                          <FormLabel className="text-base">Activated</FormLabel>
                        </FormItem>
                        <FormDescription className="text-sm text-slate-500">
                          Start recording data immediately.
                        </FormDescription>
                      </div>
                      <FormControl>
                        <Checkbox 
                          checked={field.value} 
                          onCheckedChange={field.onChange} 
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4 pt-4">
          <Button variant="outline" onClick={() => form.reset()} type="button">
            Reset Form
          </Button>
          <Button 
            type="submit" 
            disabled={isSubmitting}
            className="bg-gradient-to-r from-cyan-500 to-sky-600 text-white hover:from-cyan-600 hover:to-sky-700"
          >
            {isSubmitting ? 'Creating...' : 'Create Storage Facility'}
          </Button>
        </div>
      </form>
  );
}

import { FormDescription } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
