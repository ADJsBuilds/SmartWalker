--
-- PostgreSQL database dump
--

\restrict uOEXczhDoWiLY9dBB9zG81SrNRDdEq5o1qsTz9nJ9RLdXoRVd5Na8oTTx5Fhx3M

-- Dumped from database version 16.12
-- Dumped by pg_dump version 16.12

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clinician_documents; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.clinician_documents (
    id character varying(64) NOT NULL,
    resident_id character varying(64) NOT NULL,
    filename character varying(255) NOT NULL,
    filepath character varying(512) NOT NULL,
    uploaded_at timestamp without time zone NOT NULL,
    extracted_text text NOT NULL,
    source_type character varying(32) NOT NULL
);


ALTER TABLE public.clinician_documents OWNER TO smartwalker;

--
-- Name: daily_metric_rollups; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.daily_metric_rollups (
    id character varying(64) NOT NULL,
    resident_id character varying(64) NOT NULL,
    date date NOT NULL,
    sample_count integer NOT NULL,
    steps_max integer NOT NULL,
    cadence_sum double precision NOT NULL,
    cadence_count integer NOT NULL,
    step_var_sum double precision NOT NULL,
    step_var_count integer NOT NULL,
    fall_count integer NOT NULL,
    tilt_spike_count integer NOT NULL,
    heavy_lean_count integer NOT NULL,
    inactivity_count integer NOT NULL,
    active_seconds integer NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


ALTER TABLE public.daily_metric_rollups OWNER TO smartwalker;

--
-- Name: daily_reports; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.daily_reports (
    id character varying(64) NOT NULL,
    resident_id character varying(64) NOT NULL,
    date date NOT NULL,
    pdf_path character varying(512) NOT NULL,
    summary_json text NOT NULL,
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.daily_reports OWNER TO smartwalker;

--
-- Name: document_chunks; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.document_chunks (
    id character varying(64) NOT NULL,
    doc_id character varying(64) NOT NULL,
    resident_id character varying(64) NOT NULL,
    chunk_index integer NOT NULL,
    text text NOT NULL
);


ALTER TABLE public.document_chunks OWNER TO smartwalker;

--
-- Name: exercise_metric_samples; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.exercise_metric_samples (
    id character varying(64) NOT NULL,
    resident_id character varying(64) NOT NULL,
    camera_id character varying(64),
    ts integer NOT NULL,
    fall_suspected boolean NOT NULL,
    fall_count integer,
    total_time_on_ground_seconds double precision,
    posture_state character varying(32),
    step_count integer,
    cadence_spm double precision,
    avg_cadence_spm double precision,
    step_time_cv double precision,
    step_time_mean double precision,
    activity_state character varying(32),
    asymmetry_index double precision,
    fall_risk_level character varying(32),
    fall_risk_score double precision,
    fog_status character varying(64),
    fog_episodes integer,
    fog_duration_seconds double precision,
    person_detected boolean,
    confidence double precision,
    source_fps double precision,
    frame_id character varying(128),
    steps_merged integer,
    tilt_deg double precision,
    step_var double precision,
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.exercise_metric_samples OWNER TO smartwalker;

--
-- Name: hourly_metric_rollups; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.hourly_metric_rollups (
    id character varying(64) NOT NULL,
    resident_id character varying(64) NOT NULL,
    bucket_start_ts integer NOT NULL,
    date date NOT NULL,
    sample_count integer NOT NULL,
    steps_max integer NOT NULL,
    cadence_sum double precision NOT NULL,
    cadence_count integer NOT NULL,
    step_var_sum double precision NOT NULL,
    step_var_count integer NOT NULL,
    fall_count integer NOT NULL,
    tilt_spike_count integer NOT NULL,
    heavy_lean_count integer NOT NULL,
    inactivity_count integer NOT NULL,
    active_seconds integer NOT NULL,
    updated_at timestamp without time zone NOT NULL
);


ALTER TABLE public.hourly_metric_rollups OWNER TO smartwalker;

--
-- Name: ingest_events; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.ingest_events (
    id character varying(64) NOT NULL,
    resident_id character varying(64) NOT NULL,
    ts integer NOT NULL,
    event_type character varying(64) NOT NULL,
    severity character varying(32) NOT NULL,
    payload_json text NOT NULL,
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.ingest_events OWNER TO smartwalker;

--
-- Name: metric_samples; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.metric_samples (
    id character varying(64) NOT NULL,
    resident_id character varying(64) NOT NULL,
    ts integer NOT NULL,
    walker_json text NOT NULL,
    vision_json text NOT NULL,
    merged_json text NOT NULL
);


ALTER TABLE public.metric_samples OWNER TO smartwalker;

--
-- Name: residents; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.residents (
    id character varying(64) NOT NULL,
    name character varying(200),
    created_at timestamp without time zone NOT NULL
);


ALTER TABLE public.residents OWNER TO smartwalker;

--
-- Name: walking_sessions; Type: TABLE; Schema: public; Owner: smartwalker
--

CREATE TABLE public.walking_sessions (
    id character varying(64) NOT NULL,
    resident_id character varying(64) NOT NULL,
    start_ts integer,
    end_ts integer,
    summary_json text NOT NULL
);


ALTER TABLE public.walking_sessions OWNER TO smartwalker;

--
-- Data for Name: clinician_documents; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.clinician_documents (id, resident_id, filename, filepath, uploaded_at, extracted_text, source_type) FROM stdin;
\.


--
-- Data for Name: daily_metric_rollups; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.daily_metric_rollups (id, resident_id, date, sample_count, steps_max, cadence_sum, cadence_count, step_var_sum, step_var_count, fall_count, tilt_spike_count, heavy_lean_count, inactivity_count, active_seconds, updated_at) FROM stdin;
\.


--
-- Data for Name: daily_reports; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.daily_reports (id, resident_id, date, pdf_path, summary_json, created_at) FROM stdin;
\.


--
-- Data for Name: document_chunks; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.document_chunks (id, doc_id, resident_id, chunk_index, text) FROM stdin;
\.


--
-- Data for Name: exercise_metric_samples; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.exercise_metric_samples (id, resident_id, camera_id, ts, fall_suspected, fall_count, total_time_on_ground_seconds, posture_state, step_count, cadence_spm, avg_cadence_spm, step_time_cv, step_time_mean, activity_state, asymmetry_index, fall_risk_level, fall_risk_score, fog_status, fog_episodes, fog_duration_seconds, person_detected, confidence, source_fps, frame_id, steps_merged, tilt_deg, step_var, created_at) FROM stdin;
\.


--
-- Data for Name: hourly_metric_rollups; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.hourly_metric_rollups (id, resident_id, bucket_start_ts, date, sample_count, steps_max, cadence_sum, cadence_count, step_var_sum, step_var_count, fall_count, tilt_spike_count, heavy_lean_count, inactivity_count, active_seconds, updated_at) FROM stdin;
\.


--
-- Data for Name: ingest_events; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.ingest_events (id, resident_id, ts, event_type, severity, payload_json, created_at) FROM stdin;
\.


--
-- Data for Name: metric_samples; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.metric_samples (id, resident_id, ts, walker_json, vision_json, merged_json) FROM stdin;
\.


--
-- Data for Name: residents; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.residents (id, name, created_at) FROM stdin;
\.


--
-- Data for Name: walking_sessions; Type: TABLE DATA; Schema: public; Owner: smartwalker
--

COPY public.walking_sessions (id, resident_id, start_ts, end_ts, summary_json) FROM stdin;
\.


--
-- Name: clinician_documents clinician_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.clinician_documents
    ADD CONSTRAINT clinician_documents_pkey PRIMARY KEY (id);


--
-- Name: daily_metric_rollups daily_metric_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.daily_metric_rollups
    ADD CONSTRAINT daily_metric_rollups_pkey PRIMARY KEY (id);


--
-- Name: daily_reports daily_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_pkey PRIMARY KEY (id);


--
-- Name: document_chunks document_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_pkey PRIMARY KEY (id);


--
-- Name: exercise_metric_samples exercise_metric_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.exercise_metric_samples
    ADD CONSTRAINT exercise_metric_samples_pkey PRIMARY KEY (id);


--
-- Name: hourly_metric_rollups hourly_metric_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.hourly_metric_rollups
    ADD CONSTRAINT hourly_metric_rollups_pkey PRIMARY KEY (id);


--
-- Name: ingest_events ingest_events_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.ingest_events
    ADD CONSTRAINT ingest_events_pkey PRIMARY KEY (id);


--
-- Name: metric_samples metric_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.metric_samples
    ADD CONSTRAINT metric_samples_pkey PRIMARY KEY (id);


--
-- Name: residents residents_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.residents
    ADD CONSTRAINT residents_pkey PRIMARY KEY (id);


--
-- Name: daily_reports uq_daily_report_resident_date; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT uq_daily_report_resident_date UNIQUE (resident_id, date);


--
-- Name: daily_metric_rollups uq_daily_rollup_resident_date; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.daily_metric_rollups
    ADD CONSTRAINT uq_daily_rollup_resident_date UNIQUE (resident_id, date);


--
-- Name: document_chunks uq_doc_chunk_index; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT uq_doc_chunk_index UNIQUE (doc_id, chunk_index);


--
-- Name: hourly_metric_rollups uq_hourly_rollup_resident_bucket; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.hourly_metric_rollups
    ADD CONSTRAINT uq_hourly_rollup_resident_bucket UNIQUE (resident_id, bucket_start_ts);


--
-- Name: walking_sessions walking_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.walking_sessions
    ADD CONSTRAINT walking_sessions_pkey PRIMARY KEY (id);


--
-- Name: ix_clinician_documents_resident_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_clinician_documents_resident_id ON public.clinician_documents USING btree (resident_id);


--
-- Name: ix_daily_metric_rollups_date; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_daily_metric_rollups_date ON public.daily_metric_rollups USING btree (date);


--
-- Name: ix_daily_metric_rollups_resident_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_daily_metric_rollups_resident_id ON public.daily_metric_rollups USING btree (resident_id);


--
-- Name: ix_daily_reports_date; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_daily_reports_date ON public.daily_reports USING btree (date);


--
-- Name: ix_daily_reports_resident_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_daily_reports_resident_id ON public.daily_reports USING btree (resident_id);


--
-- Name: ix_document_chunks_doc_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_document_chunks_doc_id ON public.document_chunks USING btree (doc_id);


--
-- Name: ix_document_chunks_resident_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_document_chunks_resident_id ON public.document_chunks USING btree (resident_id);


--
-- Name: ix_exercise_metric_samples_camera_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_exercise_metric_samples_camera_id ON public.exercise_metric_samples USING btree (camera_id);


--
-- Name: ix_exercise_metric_samples_resident_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_exercise_metric_samples_resident_id ON public.exercise_metric_samples USING btree (resident_id);


--
-- Name: ix_exercise_metric_samples_ts; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_exercise_metric_samples_ts ON public.exercise_metric_samples USING btree (ts);


--
-- Name: ix_hourly_metric_rollups_bucket_start_ts; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_hourly_metric_rollups_bucket_start_ts ON public.hourly_metric_rollups USING btree (bucket_start_ts);


--
-- Name: ix_hourly_metric_rollups_date; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_hourly_metric_rollups_date ON public.hourly_metric_rollups USING btree (date);


--
-- Name: ix_hourly_metric_rollups_resident_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_hourly_metric_rollups_resident_id ON public.hourly_metric_rollups USING btree (resident_id);


--
-- Name: ix_ingest_events_event_type; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_ingest_events_event_type ON public.ingest_events USING btree (event_type);


--
-- Name: ix_ingest_events_resident_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_ingest_events_resident_id ON public.ingest_events USING btree (resident_id);


--
-- Name: ix_ingest_events_ts; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_ingest_events_ts ON public.ingest_events USING btree (ts);


--
-- Name: ix_metric_samples_resident_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_metric_samples_resident_id ON public.metric_samples USING btree (resident_id);


--
-- Name: ix_metric_samples_ts; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_metric_samples_ts ON public.metric_samples USING btree (ts);


--
-- Name: ix_walking_sessions_resident_id; Type: INDEX; Schema: public; Owner: smartwalker
--

CREATE INDEX ix_walking_sessions_resident_id ON public.walking_sessions USING btree (resident_id);


--
-- Name: clinician_documents clinician_documents_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.clinician_documents
    ADD CONSTRAINT clinician_documents_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: daily_metric_rollups daily_metric_rollups_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.daily_metric_rollups
    ADD CONSTRAINT daily_metric_rollups_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: daily_reports daily_reports_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.daily_reports
    ADD CONSTRAINT daily_reports_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: document_chunks document_chunks_doc_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES public.clinician_documents(id);


--
-- Name: document_chunks document_chunks_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.document_chunks
    ADD CONSTRAINT document_chunks_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: exercise_metric_samples exercise_metric_samples_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.exercise_metric_samples
    ADD CONSTRAINT exercise_metric_samples_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: hourly_metric_rollups hourly_metric_rollups_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.hourly_metric_rollups
    ADD CONSTRAINT hourly_metric_rollups_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: ingest_events ingest_events_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.ingest_events
    ADD CONSTRAINT ingest_events_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: metric_samples metric_samples_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.metric_samples
    ADD CONSTRAINT metric_samples_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- Name: walking_sessions walking_sessions_resident_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: smartwalker
--

ALTER TABLE ONLY public.walking_sessions
    ADD CONSTRAINT walking_sessions_resident_id_fkey FOREIGN KEY (resident_id) REFERENCES public.residents(id);


--
-- PostgreSQL database dump complete
--

\unrestrict uOEXczhDoWiLY9dBB9zG81SrNRDdEq5o1qsTz9nJ9RLdXoRVd5Na8oTTx5Fhx3M

