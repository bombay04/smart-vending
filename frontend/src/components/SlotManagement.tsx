import { type FormEvent, useEffect, useState } from "react";
import {
  AdminSlotApiError,
  fetchAdminSlots,
  updateAdminSlot,
} from "../api/admin-slot";
import type { Slot, SlotConfigurationInput } from "../types/slot";
import ProductMedia from "./ProductMedia";

type EditState = SlotConfigurationInput & { slotNumber: number };

function toEditState(slot: Slot): EditState {
  if (!slot.product) {
    return {
      slotNumber: slot.slotNumber,
      name: "",
      price: "",
      imageUrl: null,
      isActive: true,
    };
  }
  return {
    slotNumber: slot.slotNumber,
    name: slot.product.name,
    price: slot.product.price,
    imageUrl: slot.product.imageUrl,
    isActive: slot.product.isActive,
  };
}

function validate(edit: EditState): string | null {
  if (!edit.name.trim()) return "กรุณากรอกชื่อสินค้า";
  const price = Number(edit.price);
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(edit.price.trim()) ||
    !Number.isFinite(price) ||
    price <= 0 ||
    price > 99_999_999.99
  ) {
    return "ราคาต้องเป็นจำนวนบวกและมีทศนิยมไม่เกิน 2 ตำแหน่ง";
  }
  if (edit.imageUrl?.trim()) {
    try {
      if (new URL(edit.imageUrl.trim()).protocol !== "https:") throw new Error();
    } catch {
      return "URL รูปภาพต้องเป็น HTTPS ที่ถูกต้อง";
    }
  }
  return null;
}

function SlotManagement() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(false);
    try {
      setSlots(await fetchAdminSlots(signal));
    } catch {
      if (!signal?.aborted) setLoadError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit || saving) return;
    const validationError = validate(edit);
    if (validationError) {
      setSaveError(validationError);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateAdminSlot(edit.slotNumber, {
        name: edit.name.trim(),
        price: edit.price.trim(),
        imageUrl: edit.imageUrl?.trim() || null,
        isActive: edit.isActive,
      });
      setSlots((current) =>
        current.map((slot) =>
          slot.slotNumber === updated.slotNumber ? updated : slot,
        ),
      );
      setEdit(null);
    } catch (error) {
      setSaveError(
        error instanceof AdminSlotApiError && error.code === "SLOT_PAYMENT_ACTIVE"
          ? "ช่องนี้มีรายการชำระเงินที่กำลังดำเนินการ กรุณารอให้รายการสิ้นสุด"
          : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="slot-management" aria-labelledby="slot-management-title">
      <div className="staff-section-heading">
        <div>
          <h2 id="slot-management-title">จัดการช่องสินค้า</h2>
          <p>การแก้ไขข้อมูลไม่ใช่การเติมสินค้า สินค้าจริงในตู้ต้องตรงกับข้อมูลที่ตั้งค่า</p>
        </div>
      </div>
      {loading && <p className="staff-message">กำลังโหลดข้อมูลช่องสินค้า...</p>}
      {loadError && (
        <div className="staff-message staff-message--error" role="alert">
          <span>ไม่สามารถโหลดข้อมูลช่องสินค้าได้</span>
          <button type="button" onClick={() => void load()}>
            ลองอีกครั้ง
          </button>
        </div>
      )}
      {!loading && !loadError && (
        <div className="admin-slot-grid">
          {slots.map((slot) => (
            <article className="admin-slot-card" key={slot.slotNumber}>
              <div className="slot-card__header">
                <h3>ช่อง {slot.slotNumber}</h3>
                <span
                  className={`status-badge status-badge--${slot.status.toLowerCase()}`}
                >
                  {slot.status === "AVAILABLE" ? "พร้อมจำหน่าย" : "สินค้าหมด"}
                </span>
              </div>
              {edit?.slotNumber === slot.slotNumber ? (
                <form
                  className="admin-slot-form"
                  onSubmit={(event) => void save(event)}
                >
                  <label>
                    ชื่อสินค้า
                    <input
                      maxLength={120}
                      value={edit.name}
                      onChange={(event) =>
                        setEdit({ ...edit, name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    ราคาขาย (บาท)
                    <input
                      inputMode="decimal"
                      value={edit.price}
                      onChange={(event) =>
                        setEdit({ ...edit, price: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    URL รูปภาพ (ไม่บังคับ)
                    <input
                      type="url"
                      placeholder="https://..."
                      value={edit.imageUrl ?? ""}
                      onChange={(event) =>
                        setEdit({ ...edit, imageUrl: event.target.value })
                      }
                    />
                  </label>
                  <label className="admin-slot-checkbox">
                    <input
                      type="checkbox"
                      checked={edit.isActive}
                      onChange={(event) =>
                        setEdit({ ...edit, isActive: event.target.checked })
                      }
                    />
                    เปิดจำหน่ายสินค้า
                  </label>
                  {saveError && (
                    <p className="staff-inline-error" role="alert">
                      {saveError}
                    </p>
                  )}
                  <div className="admin-slot-actions">
                    <button type="submit" disabled={saving}>
                      {saving ? "กำลังบันทึก..." : "บันทึก"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setEdit(null);
                        setSaveError(null);
                      }}
                    >
                      ยกเลิก
                    </button>
                  </div>
                </form>
              ) : slot.product ? (
                <>
                  <ProductMedia
                    name={slot.product.name}
                    imageUrl={slot.product.imageUrl}
                  />
                  <dl className="admin-slot-details">
                    <div>
                      <dt>สินค้า</dt>
                      <dd>{slot.product.name}</dd>
                    </div>
                    <div>
                      <dt>ราคา</dt>
                      <dd>{slot.product.price} บาท</dd>
                    </div>
                    <div>
                      <dt>การขาย</dt>
                      <dd>
                        {slot.product.isActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                      </dd>
                    </div>
                  </dl>
                  <button
                    className="admin-slot-edit"
                    type="button"
                    onClick={() => {
                      setEdit(toEditState(slot));
                      setSaveError(null);
                    }}
                  >
                    แก้ไข
                  </button>
                </>
              ) : (
                <>
                  <p className="staff-message">ช่องนี้ยังไม่มีสินค้า</p>
                  <button
                    className="admin-slot-edit"
                    type="button"
                    onClick={() => {
                      setEdit(toEditState(slot));
                      setSaveError(null);
                    }}
                  >
                    ตั้งค่าสินค้า
                  </button>
                </>
              )}
            </article>
          ))}
        </div>
      )}
      <p className="admin-slot-restock-note">
        หากช่องมีสถานะสินค้าหมด ให้ใช้ขั้นตอนเติมสินค้าที่หน้า Staff เท่านั้น
      </p>
    </section>
  );
}

export default SlotManagement;
